import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JobRepository } from "../bridge/job-repository.js";
import { repairProcessingTimes } from "./repair-processing-times.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "h3-processing-repair-"));
const outputDir = path.join(dataDir, "comfy-output");
const jobs = new JobRepository(dataDir);
const databasePath = jobs.databasePath;
const createdAt = "2026-08-27T10:00:00.000Z";
const corruptUpdatedAt = "2026-08-27T12:00:00.000Z";
const outputMtime = "2026-08-27T10:05:00.000Z";
const withinToleranceUpdatedAt = "2026-08-27T10:05:00.001Z";
const withinFiveMinutesUpdatedAt = "2026-08-27T10:10:00.000Z";
const validUpdatedAt = "2026-08-27T10:04:00.000Z";
const beforeCreatedMtime = "2026-08-27T09:59:00.000Z";

mkdirSync(outputDir, { recursive: true });

function insertCandidate(input: {
  id: string;
  status?: "ready" | "failed";
  filename?: string | null;
  subfolder?: string | null;
  outputType?: string | null;
  updatedAt?: string;
}) {
  const status = input.status ?? "ready";
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(
      `INSERT INTO jobs(
        id, status, created_at, updated_at, prompt, candidate_count,
        duration_seconds, megapixels, generation_mode, aspect_format,
        model, lora, lora_strength, steps
      ) VALUES (?, ?, ?, ?, 'Repair test', 1, 5, 0.5, 'T2V',
                '16:9 landscape', 'test-model', '', 0, 8)`,
    ).run(
      input.id,
      status === "ready" ? "completed" : "failed",
      createdAt,
      input.updatedAt ?? corruptUpdatedAt,
    );
    database.prepare(
      `INSERT INTO candidates(
        job_id, candidate_index, seed, filename_prefix, status,
        api_prompt_json, output_filename, output_subfolder, output_type,
        output_format, created_at, updated_at
      ) VALUES (?, 1, '123', ?, ?, '{}', ?, ?, ?, 'video/mp4', ?, ?)`,
    ).run(
      input.id,
      `test/${input.id}`,
      status,
      input.filename === undefined ? `${input.id}.mp4` : input.filename,
      input.subfolder === undefined ? "video/test" : input.subfolder,
      input.outputType === undefined ? "output" : input.outputType,
      createdAt,
      input.updatedAt ?? corruptUpdatedAt,
    );
  } finally {
    database.close();
  }
}

function createOutput(
  filename: string,
  mtime = outputMtime,
  subfolder = "video/test",
) {
  const directory = path.join(outputDir, subfolder);
  mkdirSync(directory, { recursive: true });
  const output = path.join(directory, filename);
  writeFileSync(output, "video");
  const timestamp = new Date(mtime);
  utimesSync(output, timestamp, timestamp);
  return output;
}

function candidateUpdatedAt(jobId: string, databaseFile = databasePath) {
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    return (database.prepare(
      "SELECT updated_at FROM candidates WHERE job_id = ? AND candidate_index = 1",
    ).get(jobId) as { updated_at: string }).updated_at;
  } finally {
    database.close();
  }
}

try {
  jobs.close();
  insertCandidate({ id: "repair-me" });
  createOutput("repair-me.mp4");

  insertCandidate({ id: "already-valid", updatedAt: validUpdatedAt });
  createOutput("already-valid.mp4");

  insertCandidate({
    id: "within-one-ms-tolerance",
    updatedAt: withinToleranceUpdatedAt,
  });
  createOutput("within-one-ms-tolerance.mp4");

  insertCandidate({
    id: "within-five-minute-tolerance",
    updatedAt: withinFiveMinutesUpdatedAt,
  });
  createOutput("within-five-minute-tolerance.mp4");

  insertCandidate({ id: "missing-output" });

  insertCandidate({ id: "failed-candidate", status: "failed" });
  createOutput("failed-candidate.mp4");

  insertCandidate({ id: "input-output", outputType: "input" });
  createOutput("input-output.mp4");

  insertCandidate({ id: "mtime-before-created" });
  createOutput("mtime-before-created.mp4", beforeCreatedMtime);

  insertCandidate({
    id: "unsafe-output",
    filename: "../outside.mp4",
    subfolder: "",
  });
  const outside = path.join(dataDir, "outside.mp4");
  writeFileSync(outside, "outside");
  utimesSync(outside, new Date(outputMtime), new Date(outputMtime));

  insertCandidate({ id: "missing-metadata", filename: null });

  const variantDatabase = new DatabaseSync(databasePath);
  try {
    variantDatabase.prepare(
      `INSERT INTO candidate_variants(
        id, source_job_id, source_candidate_index, kind, stage, status,
        api_prompt_json, filename_prefix, output_filename, output_subfolder,
        output_type, output_format, created_at, updated_at
      ) VALUES (
        'untouched-variant', 'repair-me', 1, 'upscale', 'upscale', 'ready',
        '{}', 'test/variant', 'repair-me.mp4', 'video/test',
        'output', 'video/mp4', ?, ?
      )`,
    ).run(createdAt, corruptUpdatedAt);
  } finally {
    variantDatabase.close();
  }

  const dryRun = await repairProcessingTimes({
    databasePath,
    comfyOutputDir: outputDir,
  });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.scannedReady, 9);
  assert.equal(dryRun.eligible, 1);
  assert.equal(dryRun.updated, 0);
  assert.equal(dryRun.repairs[0]?.jobId, "repair-me");
  assert.equal(dryRun.repairs[0]?.processingSeconds, 300);
  assert.equal(candidateUpdatedAt("repair-me"), corruptUpdatedAt);
  const skipReasons = new Set(dryRun.skipped.map((item) => item.reason));
  assert(skipReasons.has("timestamp-not-corrupt"));
  assert(skipReasons.has("output-not-found"));
  assert(skipReasons.has("unsupported-output-type"));
  assert(skipReasons.has("output-before-candidate"));
  assert(skipReasons.has("unsafe-output-path"));
  assert(skipReasons.has("missing-output-metadata"));
  assert.equal(
    dryRun.skipped.find((item) => item.jobId === "within-one-ms-tolerance")?.reason,
    "timestamp-not-corrupt",
  );
  assert.equal(
    dryRun.skipped.find((item) => item.jobId === "within-five-minute-tolerance")?.reason,
    "timestamp-not-corrupt",
  );

  await assert.rejects(
    repairProcessingTimes({
      databasePath,
      comfyOutputDir: outputDir,
      apply: true,
    }),
    /--bridge-stopped/,
  );
  assert.equal(candidateUpdatedAt("repair-me"), corruptUpdatedAt);

  const backupPath = path.join(dataDir, "processing-times.backup.sqlite");
  const applied = await repairProcessingTimes({
    databasePath,
    comfyOutputDir: outputDir,
    backupPath,
    apply: true,
    bridgeStopped: true,
  });
  assert.equal(applied.mode, "apply");
  assert.equal(applied.eligible, 1);
  assert.equal(applied.updated, 1);
  assert.equal(applied.backupPath, backupPath);
  assert(existsSync(backupPath));
  assert.equal(candidateUpdatedAt("repair-me"), outputMtime);
  assert.equal(candidateUpdatedAt("repair-me", backupPath), corruptUpdatedAt);
  assert.equal(candidateUpdatedAt("already-valid"), validUpdatedAt);
  assert.equal(
    candidateUpdatedAt("within-one-ms-tolerance"),
    withinToleranceUpdatedAt,
  );
  assert.equal(
    candidateUpdatedAt("within-five-minute-tolerance"),
    withinFiveMinutesUpdatedAt,
  );
  assert.equal(candidateUpdatedAt("missing-output"), corruptUpdatedAt);
  assert.equal(candidateUpdatedAt("failed-candidate"), corruptUpdatedAt);

  const variantCheck = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const variant = variantCheck.prepare(
      "SELECT updated_at FROM candidate_variants WHERE id = 'untouched-variant'",
    ).get() as { updated_at: string };
    assert.equal(variant.updated_at, corruptUpdatedAt);
  } finally {
    variantCheck.close();
  }

  const after = await repairProcessingTimes({
    databasePath,
    comfyOutputDir: outputDir,
  });
  assert.equal(after.eligible, 0);
  assert.equal(after.updated, 0);

  console.log("Processing time repair: OK");
} finally {
  try {
    jobs.close();
  } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
