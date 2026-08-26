import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComfyClient } from "../bridge/comfy-client.js";
import { TimelineExportService } from "../bridge/timeline-export.js";

type JobList = {
  jobs?: Array<{
    candidates: Array<{
      status: string;
      output: null | { mediaPath: string; filename: string };
    }>;
  }>;
};

const bridgeUrl = process.env.H3_BRIDGE_URL?.trim() || "http://127.0.0.1:8787";
const comfyUrl = process.env.H3_COMFY_URL?.trim() || "http://127.0.0.1:9000";
const ffmpegPath = process.env.H3_FFMPEG_PATH?.trim() || "C:\\ffmpeg\\bin\\ffmpeg.exe";
const testDir = mkdtempSync(path.join(tmpdir(), "h3-studio-export-test-"));

try {
  if (!existsSync(ffmpegPath)) throw new Error(`FFmpeg non trovato: ${ffmpegPath}`);
  const response = await fetch(`${bridgeUrl}/api/jobs?limit=25`);
  if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
  const payload = (await response.json()) as JobList;
  const candidate = payload.jobs
    ?.flatMap((job) => job.candidates)
    .find((item) => item.status === "ready" && item.output);
  if (!candidate?.output) throw new Error("Nessun candidato pronto per il test export");

  const service = new TimelineExportService(
    new ComfyClient(comfyUrl, 5_000),
    testDir,
    ffmpegPath,
  );
  const result = await service.export({
    id: "test-timeline",
    projectId: "test-project",
    projectName: "Export test",
    name: "Montaggio test",
    externalAudioFile: null,
    externalAudioName: null,
    originalAudioGain: 1,
    externalAudioGain: 1,
    externalAudioLoop: false,
    clips: [{ trimStart: 0.2, trimEnd: 1.2, volume: 1, output: candidate.output }],
  });
  const size = statSync(result.outputPath).size;
  if (size < 1_024) throw new Error(`Export troppo piccolo: ${size} byte`);
  console.log(`Timeline export: OK (${size} byte, ${result.filename})`);
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
