import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ComfyClient } from "../bridge/comfy-client.js";
import { CreativeLibraryRepository } from "../bridge/creative-library-repository.js";
import { JobRepository } from "../bridge/job-repository.js";
import { KreaAssetService } from "../bridge/krea-asset-service.js";
import { RuntimeSettingsStore } from "../bridge/runtime-settings.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "h3-studio-library-"));
const jobs = new JobRepository(dataDir);
const library = new CreativeLibraryRepository(jobs.databasePath);

try {
  const character = library.create({
    kind: "character",
    name: "Kael",
    description: "Adult fantasy mage with silver hair and a cobalt coat",
    generationPrompt: "Realistic adult fantasy mage, silver hair, cobalt coat",
  });
  const object = library.create({
    kind: "object",
    name: "Solar blade",
    description: "Gold and ivory ceremonial sword",
  });
  assert.equal(library.list().length, 2);
  assert.equal(library.list("character")[0].id, character.id);
  assert.equal(library.list("object")[0].id, object.id);

  const withReference = library.addReference(character.id, {
    file: "h3_uploads/kael.png [input]",
    name: "kael.png",
    label: "Face",
    role: "primary",
    source: "upload",
    width: 1024,
    height: 1024,
  });
  assert.equal(withReference.referenceCount, 1);
  assert.match(withReference.references[0].mediaPath, /api\/media/);

  const service = new KreaAssetService(
    new ComfyClient("http://127.0.0.1:9000", 3_000),
    library,
    "KREA2_ULTRA_WORKFLOW.json",
    new RuntimeSettingsStore(dataDir),
  );
  const dryRun = await service.dryRun(character.id, { seed: 1234 });
  assert.equal(dryRun.apiNodeCount, 11);
  assert.equal(dryRun.seed, 1234);
  assert.match(dryRun.prompt, /four clean views/i);
  assert.match(dryRun.filenamePrefix, /H3_STUDIO\/library/);

  const database = new DatabaseSync(jobs.databasePath, { readOnly: true });
  try {
    const migration = database
      .prepare("SELECT version FROM schema_migrations WHERE version = 7")
      .get() as { version: number } | undefined;
    assert.equal(migration?.version, 7);
    const plan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM creative_asset_references
         WHERE asset_id = ? ORDER BY position`,
      )
      .all(character.id) as Array<{ detail: string }>;
    assert(plan.some((row) => row.detail.includes("idx_creative_references_asset_position")));
  } finally {
    database.close();
  }

  const cleaned = library.removeReference(withReference.references[0].id);
  assert.equal(cleaned.referenceCount, 0);
  library.delete(object.id);
  assert.equal(library.list().length, 1);
  console.log("Creative library + Krea 2 dry-run: OK");
} finally {
  library.close();
  jobs.close();
  rmSync(dataDir, { recursive: true, force: true });
}
