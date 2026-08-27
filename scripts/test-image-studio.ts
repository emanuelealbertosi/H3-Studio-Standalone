import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JobRepository } from "../bridge/job-repository.js";
import {
  ImageJobRepository,
  type ImageJobReferenceInput,
  type PreparedImageJob,
} from "../bridge/image-job-repository.js";
import {
  buildFlux2KleinEditPrompt,
  buildKreaGeneratePrompt,
} from "../bridge/image-workflow-builder.js";
import { ProjectRepository } from "../bridge/project-repository.js";
import {
  DEFAULT_RUNTIME_SETTINGS,
  RuntimeSettingsStore,
} from "../bridge/runtime-settings.js";

const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "h3-image-studio-"));

function reference(index: number): ImageJobReferenceInput {
  return {
    file: `uploads/reference-${index}.png [input]`,
    name: `reference-${index}.png`,
    role: index === 1 ? "base" : "other",
    width: 1024,
    height: 1024,
  };
}

try {
  const jobs = new JobRepository(temporaryDir);
  const projects = new ProjectRepository(jobs.databasePath);
  const images = new ImageJobRepository(jobs.databasePath);
  const firstProject = projects.create("Immagini A");
  const secondProject = projects.create("Immagini B");
  assert(firstProject && secondProject);

  const schema = new DatabaseSync(jobs.databasePath);
  const migration = schema
    .prepare("SELECT version FROM schema_migrations WHERE version = 15")
    .get() as { version: number } | undefined;
  assert.equal(migration?.version, 15);
  const tables = new Set(
    (
      schema
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name LIKE 'image_%'
              OR name = 'project_image_links'`,
        )
        .all() as unknown as Array<{ name: string }>
    ).map((row) => row.name),
  );
  assert.deepEqual(
    [...tables].sort(),
    [
      "image_candidates",
      "image_job_references",
      "image_jobs",
      "project_image_links",
    ],
  );
  schema.close();

  const editSettings = {
    ...DEFAULT_RUNTIME_SETTINGS.imageEdit,
    kvCacheEnabled: false,
    attentionBackend: "auto" as const,
  };
  const oneReferenceGraph = buildFlux2KleinEditPrompt({
    prompt: "Change the coat to blue",
    seed: 1,
    width: 1024,
    height: 1024,
    filenamePrefix: "tests/one",
    settings: editSettings,
    references: [reference(1)],
  });
  assert.equal(
    Object.values(oneReferenceGraph).filter((node) => node.class_type === "LoadImage").length,
    1,
  );
  assert.deepEqual(oneReferenceGraph["60"].inputs.positive, ["23", 0]);
  assert.deepEqual(oneReferenceGraph["60"].inputs.negative, ["24", 0]);
  assert.equal(oneReferenceGraph["20"].inputs.image, "uploads/reference-1.png [input]");
  assert.match(String(oneReferenceGraph["4"].inputs.text), /Image 1 = base image/);
  assert.equal(oneReferenceGraph["10"], undefined);
  assert.equal(oneReferenceGraph["11"], undefined);

  const outputReferenceGraph = buildFlux2KleinEditPrompt({
    prompt: "Reuse an H3 Studio output",
    seed: 11,
    width: 1024,
    height: 1024,
    filenamePrefix: "tests/output-reference",
    settings: editSettings,
    references: [{
      ...reference(1),
      file: "images/H3_STUDIO/generated.png [output]",
    }],
    template: {
      "99": {
        class_type: "PreviewImage",
        inputs: { images: ["62", 0] },
      },
    },
  });
  assert.equal(
    outputReferenceGraph["20"].inputs.image,
    "images/H3_STUDIO/generated.png [output]",
  );
  assert.equal(outputReferenceGraph["99"].class_type, "PreviewImage");

  const fourReferences = [1, 2, 3, 4].map(reference);
  const fourReferenceGraph = buildFlux2KleinEditPrompt({
    prompt: "Combine the references",
    seed: 2,
    width: 1344,
    height: 768,
    filenamePrefix: "tests/four",
    settings: {
      ...editSettings,
      kvCacheEnabled: true,
      attentionBackend: "comfy kitchen attention",
    },
    references: fourReferences,
  });
  assert.equal(
    Object.values(fourReferenceGraph).filter((node) => node.class_type === "LoadImage").length,
    4,
  );
  assert.deepEqual(fourReferenceGraph["60"].inputs.positive, ["38", 0]);
  assert.deepEqual(fourReferenceGraph["60"].inputs.negative, ["39", 0]);
  assert.deepEqual(fourReferenceGraph["11"].inputs.model, ["1", 0]);
  assert.deepEqual(fourReferenceGraph["10"].inputs.model, ["11", 0]);
  assert.deepEqual(fourReferenceGraph["60"].inputs.model, ["10", 0]);
  assert.equal(fourReferenceGraph["9"].inputs.steps, 4);
  assert.equal(fourReferenceGraph["60"].inputs.cfg, 1);

  assert.throws(
    () =>
      buildFlux2KleinEditPrompt({
        prompt: "Too many references",
        seed: 3,
        width: 1024,
        height: 1024,
        filenamePrefix: "tests/five",
        settings: editSettings,
        references: [1, 2, 3, 4, 5].map(reference),
      }),
    /1 a 4 reference/,
  );
  assert.throws(
    () =>
      buildKreaGeneratePrompt({
        prompt: "Invalid size",
        seed: 4,
        width: 4096,
        height: 4096,
        filenamePrefix: "tests/oversize",
        settings: DEFAULT_RUNTIME_SETTINGS.krea,
      }),
    /4 megapixel/,
  );

  const prepared: PreparedImageJob = {
    id: "image-job-test",
    originProjectId: firstProject.id,
    mode: "edit",
    prompt: "Combine the references",
    candidateCount: 2,
    aspectFormat: "16:9",
    width: 1344,
    height: 768,
    seedMode: "fixed",
    requestedSeed: 42,
    tag: "background",
    engine: {
      kind: "flux2-klein-edit",
      model: editSettings.model,
      encoder: editSettings.encoder,
      vae: editSettings.vae,
      steps: editSettings.steps,
      cfg: editSettings.cfg,
      sampler: "euler",
      scheduler: "flux2",
      kvCacheEnabled: false,
      attentionBackend: "auto",
    },
    references: fourReferences,
    candidates: [
      {
        index: 1,
        seed: 42,
        filenamePrefix: "tests/repository",
        apiPrompt: fourReferenceGraph,
      },
      {
        index: 2,
        seed: 43,
        filenamePrefix: "tests/repository-2",
        apiPrompt: fourReferenceGraph,
      },
    ],
  };
  let stored = images.createPrepared(prepared);
  assert.equal(stored.references.length, 4);
  assert.equal(stored.candidates[0].projectLinks[0].projectId, firstProject.id);
  assert.equal(stored.candidates[0].projectLinks[0].tag, "background");
  images.markCandidateStatus("image-job-test", 1, "ready", {
    filename: "result.png",
    subfolder: "images/H3_STUDIO",
    type: "output",
    format: "image/png",
  });
  images.markCandidateStatus("image-job-test", 2, "ready", {
    filename: "result-2.png",
    subfolder: "images/H3_STUDIO",
    type: "output",
    format: "image/png",
  });
  stored = images.linkProject(
    "image-job-test",
    1,
    secondProject.id,
    "character",
  );
  assert.equal(stored.candidates[0].projectLinks.length, 2);
  const sharedProjectJobs = images.list(20, secondProject.id);
  assert.equal(sharedProjectJobs.length, 1);
  assert.deepEqual(sharedProjectJobs[0].candidates.map((candidate) => candidate.index), [1]);
  stored = images.linkProject("image-job-test", 1, secondProject.id, "object");
  assert.equal(
    stored.candidates[0].projectLinks.find(
      (link) => link.projectId === secondProject.id,
    )?.tag,
    "object",
  );
  stored = images.unlinkProject("image-job-test", 1, secondProject.id);
  assert.equal(stored.candidates[0].projectLinks.length, 1);
  assert.equal(images.list(20, secondProject.id).length, 0);
  assert.equal(images.select("image-job-test", 1).selectedCandidateIndex, 1);

  const oldSettings = {
    h3: DEFAULT_RUNTIME_SETTINGS.h3,
    fast: DEFAULT_RUNTIME_SETTINGS.fast,
    krea: DEFAULT_RUNTIME_SETTINGS.krea,
  };
  await writeFile(
    path.join(temporaryDir, "runtime-settings.json"),
    JSON.stringify(oldSettings),
    "utf8",
  );
  const runtime = new RuntimeSettingsStore(temporaryDir);
  const migrated = await runtime.get();
  assert.deepEqual(migrated.imageEdit, DEFAULT_RUNTIME_SETTINGS.imageEdit);
  const updated = await runtime.update({
    ...oldSettings,
    imageEdit: {
      ...DEFAULT_RUNTIME_SETTINGS.imageEdit,
      kvCacheEnabled: true,
      attentionBackend: "pytorch attention",
    },
  });
  assert.equal(updated.imageEdit.kvCacheEnabled, true);
  assert.equal(updated.imageEdit.attentionBackend, "pytorch attention");

  images.close();
  projects.close();
  jobs.close();
  console.log("Image Studio repository, graph and config tests passed.");
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
