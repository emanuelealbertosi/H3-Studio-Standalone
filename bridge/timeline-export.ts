import { execFile } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ComfyClient } from "./comfy-client.js";

const runFile = promisify(execFile);

type ExportTimeline = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  externalAudioFile: string | null;
  externalAudioName: string | null;
  originalAudioGain: number;
  externalAudioGain: number;
  externalAudioLoop: boolean;
  clips: Array<{
    trimStart: number;
    trimEnd: number;
    volume: number;
    output: { mediaPath: string; filename: string };
  }>;
};

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "montaggio";
}
function concatPath(value: string) {
  return value.replace(/\\/g, "/").replace(/'/g, "'\\''");
}
function annotatedMedia(value: string) {
  const match = /^(.*?)(?: \[(input|output|temp)\])?$/.exec(value.trim());
  const raw = (match?.[1] ?? value).replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  return {
    filename: parts.pop() ?? raw,
    subfolder: parts.join("/"),
    type: (match?.[2] ?? "input") as "input" | "output" | "temp",
  };
}

export class TimelineExportService {
  constructor(
    private readonly comfy: ComfyClient,
    private readonly dataDir: string,
    private readonly ffmpegPath: string,
  ) {}

  async export(timeline: ExportTimeline) {
    if (timeline.clips.length === 0) throw new Error("La timeline non contiene clip");
    const workDir = mkdtempSync(path.join(tmpdir(), "h3-studio-export-"));
    const exportDir = path.join(this.dataDir, "exports", timeline.projectId);
    mkdirSync(exportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${safeName(timeline.projectName)}_${safeName(timeline.name)}_${stamp}.mp4`;
    const outputPath = path.join(exportDir, filename);
    try {
      const processed: string[] = [];
      for (const [index, clip] of timeline.clips.entries()) {
        const url = new URL(clip.output.mediaPath, "http://h3.local");
        const source = await this.comfy.mediaResponse(
          url.searchParams.get("filename") ?? clip.output.filename,
          url.searchParams.get("subfolder") ?? "",
          (url.searchParams.get("type") as "input" | "output" | "temp") ?? "output",
        );
        if (!source.ok || !source.body) throw new Error(`Clip ${index + 1} non leggibile da ComfyUI`);
        const originalPath = path.join(workDir, `source_${index + 1}.mp4`);
        await pipeline(Readable.fromWeb(source.body as never), createWriteStream(originalPath));
        const processedPath = path.join(workDir, `clip_${index + 1}.mp4`);
        const duration = Math.max(0.05, clip.trimEnd - clip.trimStart);
        await runFile(
          this.ffmpegPath,
          [
            "-y", "-ss", String(clip.trimStart), "-i", originalPath, "-t", String(duration),
            "-map", "0:v:0", "-map", "0:a:0?", "-vf", "setpts=PTS-STARTPTS",
            "-af", `volume=${clip.volume},asetpts=PTS-STARTPTS`,
            "-c:v", "libx264", "-preset", "medium", "-crf", "16",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            processedPath,
          ],
          { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        );
        processed.push(processedPath);
      }

      const listPath = path.join(workDir, "concat.txt");
      const joinedPath = path.join(workDir, "joined.mp4");
      writeFileSync(listPath, processed.map(clip => `file '${concatPath(clip)}'`).join("\n"), "utf8");
      await runFile(
        this.ffmpegPath,
        ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", joinedPath],
        { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      );

      if (timeline.externalAudioFile) {
        const audio = annotatedMedia(timeline.externalAudioFile);
        const response = await this.comfy.mediaResponse(audio.filename, audio.subfolder, audio.type);
        if (!response.ok || !response.body) throw new Error("Audio esterno non leggibile da ComfyUI");
        const audioPath = path.join(workDir, `external${path.extname(audio.filename) || ".audio"}`);
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(audioPath));
        const args = ["-y", "-i", joinedPath];
        if (timeline.externalAudioLoop) args.push("-stream_loop", "-1");
        args.push("-i", audioPath);
        if (timeline.originalAudioGain <= 0) {
          args.push("-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", `volume=${timeline.externalAudioGain}`, "-c:a", "aac", "-b:a", "192k", "-shortest", outputPath);
        } else {
          args.push(
            "-filter_complex",
            `[0:a:0]volume=${timeline.originalAudioGain}[original];[1:a:0]volume=${timeline.externalAudioGain}[external];[original][external]amix=inputs=2:duration=first:dropout_transition=2[mixed]`,
            "-map", "0:v:0", "-map", "[mixed]", "-c:v", "copy", "-c:a", "aac",
            "-b:a", "192k", "-shortest", outputPath,
          );
        }
        await runFile(this.ffmpegPath, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      } else if (timeline.originalAudioGain <= 0) {
        await runFile(this.ffmpegPath, ["-y", "-i", joinedPath, "-map", "0:v:0", "-c:v", "copy", "-an", outputPath], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      } else if (Math.abs(timeline.originalAudioGain - 1) > 0.001) {
        await runFile(this.ffmpegPath, ["-y", "-i", joinedPath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-af", `volume=${timeline.originalAudioGain}`, "-c:a", "aac", "-b:a", "192k", outputPath], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      } else {
        copyFileSync(joinedPath, outputPath);
      }
      return {
        filename,
        outputPath,
        mediaPath: `/api/exports/${timeline.projectId}/${encodeURIComponent(filename)}`,
        clipCount: timeline.clips.length,
        timelineId: timeline.id,
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
