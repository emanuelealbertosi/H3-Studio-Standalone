import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CandidateVariantRepository,
} from "../bridge/candidate-variant-repository.js";
import type { ComfyApiPrompt, ComfyClient } from "../bridge/comfy-client.js";
import type { ComfyProgressTracker } from "../bridge/comfy-progress.js";
import { JobRepository } from "../bridge/job-repository.js";
import {
  PostprocessService,
  normalizeUpscaleTarget,
  upscalePrompt,
} from "../bridge/postprocess-service.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "h3-studio-postprocess-"));
const outputDir = path.join(dataDir, "output");
const jobs = new JobRepository(dataDir);
const variants = new CandidateVariantRepository(jobs.databasePath);
const database = new DatabaseSync(jobs.databasePath);
const originalPrompt = JSON.parse(
  readFileSync(path.resolve("workflows/studio-backend.api.json"), "utf8"),
) as ComfyApiPrompt;
const now = new Date().toISOString();
const queuedPrompts: ComfyApiPrompt[] = [];
let promptNumber = 0;

const comfy = {
  async objectInfo(nodeName: string) {
    if (nodeName === "H3ReferenceMemorySampler") {
      return {
        H3ReferenceMemorySampler: {
          input: { optional: { studio_upscale: ["BOOLEAN", { default: false }] } },
        },
      };
    }
    return { [nodeName]: {} };
  },
  async queuePrompt(prompt: ComfyApiPrompt) {
    queuedPrompts.push(prompt);
    promptNumber += 1;
    return { promptId: `postprocess-test-${promptNumber}`, queueNumber: promptNumber };
  },
} as unknown as ComfyClient;

const progress = {
  register() {},
  get() {
    return null;
  },
} as unknown as ComfyProgressTracker;

function insertJob(jobId: string, megapixels: 0.5 | 0.7 | 0.98, candidateCount: 1 | 2) {
  database.prepare(
    `INSERT INTO jobs(
      id, status, created_at, updated_at, prompt, candidate_count,
      duration_seconds, megapixels, generation_mode, aspect_format,
      requested_seed, seed_mode, model, lora, lora_strength, steps,
      selected_candidate_index
    ) VALUES (?, 'completed', ?, ?, 'Postprocess test', ?, 5, ?, 'T2V',
              '16:9 landscape', '123', 'base', 'test-model', 'H3 Turbo',
              1, 8, 1)`,
  ).run(jobId, now, now, candidateCount, megapixels === 0.98 ? 1 : megapixels);
  for (let index = 1; index <= candidateCount; index += 1) {
    database.prepare(
      `INSERT INTO candidates(
        job_id, candidate_index, seed, filename_prefix, prompt_id,
        queue_number, status, api_prompt_json, output_filename,
        output_subfolder, output_type, output_format, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, '', 'output', 'video/mp4', ?, ?)`,
    ).run(
      jobId,
      index,
      String(122 + index),
      `test/${jobId}/candidate_${index}`,
      `${jobId}-prompt-${index}`,
      index,
      JSON.stringify(originalPrompt),
      `${jobId}-candidate-${index}.mp4`,
      now,
      now,
    );
  }
}

function dimensions(prompt: ComfyApiPrompt) {
  const matches = Object.values(prompt).filter(
    (item) => item.class_type === "H3AspectMegapixelSize",
  );
  assert.equal(matches.length, 1);
  return matches[0];
}

try {
  insertJob("test-job", 0.5, 2);
  insertJob("native-job", 0.98, 1);

  const migration = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 16",
  ).get() as { version: number } | undefined;
  assert.equal(migration?.version, 16);
  const variantColumns = database.prepare(
    "PRAGMA table_info(candidate_variants)",
  ).all() as unknown as Array<{ name: string }>;
  assert(variantColumns.some((column) => column.name === "source_variant_id"));
  assert(variantColumns.some((column) => column.name === "target_megapixels"));

  assert.equal(dimensions(upscalePrompt(originalPrompt, "test/1mp", 1)).inputs.megapixels, 0.98);
  assert.equal(dimensions(upscalePrompt(originalPrompt, "test/2mp", 2)).inputs.megapixels, 1.96);
  assert.equal(normalizeUpscaleTarget("2"), 2);
  assert.throws(() => normalizeUpscaleTarget(3), /1 oppure 2/);

  const readyUpscale = variants.create({
    sourceJobId: "test-job",
    sourceCandidateIndex: 1,
    targetMegapixels: 1,
    kind: "upscale",
    stage: "upscale",
    prompt: upscalePrompt(originalPrompt, "test/upscale-ready", 1),
    filenamePrefix: "test/upscale-ready",
  });
  variants.updateStatus(readyUpscale.id, "ready", {
    filename: "candidate-1-upscale.mp4",
    subfolder: "variants",
    type: "output",
    format: "video/mp4",
    mediaPath: "/unused",
  });

  const service = new PostprocessService(comfy, progress, jobs, variants, outputDir);
  const chainedFace = await service.create(
    "test-job",
    1,
    "face",
    readyUpscale.id,
  );
  assert(chainedFace);
  assert.equal(chainedFace.kind, "face_upscale");
  assert.equal(chainedFace.stage, "face");
  assert.equal(chainedFace.sourceVariantId, readyUpscale.id);
  assert.equal(chainedFace.targetMegapixels, 1);

  const faceWorkflow = queuedPrompts.at(-1)!;
  assert.equal(
    faceWorkflow["101"].inputs.video,
    path.resolve(outputDir, "variants", "candidate-1-upscale.mp4"),
  );
  assert.deepEqual(faceWorkflow["112"].inputs.audio, ["101", 2]);
  assert.deepEqual(faceWorkflow["121"].inputs.audio, ["101", 2]);
  assert.equal(
    Object.values(faceWorkflow).some(
      (item) => item.class_type === "H3AspectMegapixelSize",
    ),
    false,
  );
  const parentAfterFace = variants.get(readyUpscale.id);
  assert.equal(parentAfterFace?.status, "ready");
  assert.equal(parentAfterFace?.output?.filename, "candidate-1-upscale.mp4");

  const upscale2 = await service.create("test-job", 1, "upscale", null, 2);
  assert(upscale2);
  assert.equal(upscale2.targetMegapixels, 2);
  assert.equal(upscale2.sourceVariantId, null);
  assert.equal(dimensions(queuedPrompts.at(-1)!).inputs.megapixels, 1.96);

  await assert.rejects(
    service.create("native-job", 1, "upscale", null, 1),
    /superiore alla sorgente/,
  );

  const otherCandidate = variants.create({
    sourceJobId: "test-job",
    sourceCandidateIndex: 2,
    targetMegapixels: 1,
    kind: "upscale",
    stage: "upscale",
    prompt: originalPrompt,
    filenamePrefix: "test/other-candidate",
  });
  variants.updateStatus(otherCandidate.id, "ready", {
    filename: "candidate-2-upscale.mp4",
    subfolder: "variants",
    type: "output",
    format: "video/mp4",
    mediaPath: "/unused",
  });
  await assert.rejects(
    service.create("test-job", 1, "face", otherCandidate.id),
    /non appartiene al candidato/,
  );

  const pendingUpscale = variants.create({
    sourceJobId: "test-job",
    sourceCandidateIndex: 1,
    targetMegapixels: 2,
    kind: "upscale",
    stage: "upscale",
    prompt: originalPrompt,
    filenamePrefix: "test/pending-upscale",
  });
  await assert.rejects(
    service.create("test-job", 1, "face", pendingUpscale.id),
    /deve essere completata/,
  );

  const readyFace = variants.create({
    sourceJobId: "test-job",
    sourceCandidateIndex: 1,
    kind: "face",
    stage: "face",
    prompt: originalPrompt,
    filenamePrefix: "test/ready-face",
  });
  variants.updateStatus(readyFace.id, "ready", {
    filename: "candidate-1-face.mp4",
    subfolder: "variants",
    type: "output",
    format: "video/mp4",
    mediaPath: "/unused",
  });
  await assert.rejects(
    service.create("test-job", 1, "face", readyFace.id),
    /soltanto a una variante Upscale/,
  );

  console.log("Postprocess variants: OK");
} finally {
  database.close();
  variants.close();
  jobs.close();
  rmSync(dataDir, { recursive: true, force: true });
}
