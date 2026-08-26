import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JobRepository } from "../bridge/job-repository.js";
import { ProjectRepository } from "../bridge/project-repository.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "h3-studio-projects-"));
const jobs = new JobRepository(dataDir);
const database = new DatabaseSync(jobs.databasePath);
const now = new Date().toISOString();

try {
  database
    .prepare(
      `INSERT INTO jobs(
        id, status, created_at, updated_at, prompt, candidate_count,
        duration_seconds, megapixels, generation_mode, aspect_format,
        requested_seed, seed_mode, model, lora, lora_strength, steps,
        selected_candidate_index
      ) VALUES (?, 'completed', ?, ?, ?, 1, 5, 0.5, 'T2V',
                '16:9 landscape', '123', 'base', 'test-model', 'test-lora',
                1, 8, 1)`,
    )
    .run("test-job", now, now, "Test project timeline");
  database
    .prepare(
      `INSERT INTO candidates(
        job_id, candidate_index, seed, filename_prefix, prompt_id,
        queue_number, status, api_prompt_json, output_filename,
        output_subfolder, output_type, output_format, created_at, updated_at
      ) VALUES (
        'test-job', 1, '123', 'test/candidate_1', 'test-prompt',
        1, 'ready', '{}', 'candidate_1.mp4', '', 'output', 'video/mp4', ?, ?
      )`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO candidate_variants(
        id, source_job_id, source_candidate_index, kind, stage, status,
        api_prompt_json, filename_prefix, output_filename, output_subfolder,
        output_type, output_format, created_at, updated_at
      ) VALUES (
        'test-variant', 'test-job', 1, 'upscale', 'upscale', 'ready',
        '{}', 'test/upscale', 'candidate_1_upscale.mp4', '',
        'output', 'video/mp4', ?, ?
      )`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO jobs(
        id, status, created_at, updated_at, prompt, candidate_count,
        duration_seconds, megapixels, generation_mode, aspect_format,
        requested_seed, seed_mode, model, lora, lora_strength, steps
      ) VALUES (?, 'failed', ?, ?, ?, 1, 5, 0.5, 'T2V',
                '16:9 landscape', '456', 'base', 'test-model', '',
                0, 8)`,
    )
    .run("failed-job", now, now, "Failed candidate cleanup");
  database
    .prepare(
      `INSERT INTO candidates(
        job_id, candidate_index, seed, filename_prefix, prompt_id,
        queue_number, status, api_prompt_json, error, created_at, updated_at
      ) VALUES (
        'failed-job', 1, '456', 'test/failed_candidate_1', 'failed-prompt',
        2, 'failed', '{}', 'Test failure', ?, ?
      )`,
    )
    .run(now, now);
  database.close();

  const projects = new ProjectRepository(jobs.databasePath);
  try {
    const first = projects.create("Progetto A");
    const second = projects.create("Progetto B");
    assert(first && second);

    const withClip = projects.addClip(first.id, "test-job", 1, "Apertura");
    assert.equal(withClip?.clips.length, 1);
    assert.equal(withClip?.clips[0].position, 0);
    assert.equal(first.timelines.length, 1);

    const alternate = projects.createTimeline(first.id, "Versione breve");
    assert(alternate);
    const alternateWithClip = projects.addClipToTimeline(
      alternate.id,
      "test-job",
      1,
      "Trim test",
    );
    assert.equal(alternateWithClip?.clips.length, 1);
    const trimmed = projects.updateClip(alternateWithClip!.clips[0].id, {
      trimStart: 0.5,
      trimEnd: 3.5,
      volume: 0.75,
    });
    assert.equal(trimmed?.clips[0].trimStart, 0.5);
    assert.equal(trimmed?.clips[0].trimEnd, 3.5);
    assert.equal(trimmed?.clips[0].volume, 0.75);
    const mixed = projects.updateTimeline(alternate.id, {
      externalAudioFile: "music/test.wav [input]",
      externalAudioName: "test.wav",
      originalAudioGain: 0.6,
      externalAudioGain: 1.2,
      externalAudioLoop: true,
    });
    assert.equal(mixed?.externalAudioFile, "music/test.wav [input]");
    assert.equal(mixed?.originalAudioGain, 0.6);
    assert.equal(mixed?.externalAudioLoop, true);
    assert.equal(projects.get(first.id)?.timelines.length, 2);

    const copied = projects.copyClip(withClip!.clips[0].id, second.id);
    assert.equal(copied?.clips.length, 1);

    const moved = projects.moveClip(withClip!.clips[0].id, second.id);
    assert.equal(moved?.clips.length, 2);
    assert.equal(projects.get(first.id)?.clips.length, 0);

    const reordered = projects.reorderClip(moved!.clips[1].id, 0);
    assert.equal(reordered?.clips[0].id, moved!.clips[1].id);
    assert.equal(projects.list().length, 2);

    const deleted = jobs.deleteCandidate("test-job", 1);
    assert.equal(deleted.jobDeleted, true);
    assert.equal(deleted.removedClips, 3);
    assert.deepEqual(
      deleted.files.map((file) => file.filename).sort(),
      ["candidate_1.mp4", "candidate_1_upscale.mp4"],
    );
    assert.equal(projects.get(first.id)?.clips.length, 0);
    assert.equal(projects.get(second.id)?.clips.length, 0);
    assert.equal(jobs.get("test-job"), null);

    const failedDeleted = jobs.deleteCandidate("failed-job", 1);
    assert.equal(failedDeleted.jobDeleted, true);
    assert.equal(failedDeleted.removedClips, 0);
    assert.deepEqual(failedDeleted.files, []);
    assert.equal(jobs.get("failed-job"), null);
  } finally {
    projects.close();
  }
  console.log("Project repository: OK");
} finally {
  try {
    database.close();
  } catch {}
  jobs.close();
  rmSync(dataDir, { recursive: true, force: true });
}
