import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComfyClient } from "../bridge/comfy-client.js";
import { CreativeLibraryRepository } from "../bridge/creative-library-repository.js";
import { JobRepository } from "../bridge/job-repository.js";
import { KreaAssetService } from "../bridge/krea-asset-service.js";
import { RuntimeSettingsStore } from "../bridge/runtime-settings.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const dataDir = mkdtempSync(path.join(tmpdir(), "h3-studio-krea-contract-"));
const jobs = new JobRepository(dataDir);
const library = new CreativeLibraryRepository(jobs.databasePath);
const comfy = new ComfyClient(
  process.env.H3_COMFY_URL?.trim() || "http://127.0.0.1:9000",
  8_000,
);

try {
  const asset = library.create({
    kind: "object",
    name: "Contract test object",
    description: "A polished cobalt and silver cinematic prop",
  });
  const service = new KreaAssetService(
    comfy,
    library,
    "KREA2_ULTRA_WORKFLOW.json",
    new RuntimeSettingsStore(dataDir),
  );
  const prepared = await service.prepare(asset.id, { seed: 9876 });
  const nodeIds = new Set(Object.keys(prepared.apiPrompt));

  for (const [nodeId, promptNode] of Object.entries(prepared.apiPrompt)) {
    const objectInfo = await comfy.objectInfo(promptNode.class_type);
    const classInfo = objectInfo[promptNode.class_type];
    assert(isRecord(classInfo), `Nodo ComfyUI mancante: ${promptNode.class_type}`);
    const input = classInfo.input;
    const required = isRecord(input) ? input.required : null;
    if (isRecord(required)) {
      for (const requiredName of Object.keys(required)) {
        assert(
          requiredName in promptNode.inputs,
          `${promptNode.class_type} (${nodeId}) senza input ${requiredName}`,
        );
      }
    }
    for (const value of Object.values(promptNode.inputs)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        typeof value[1] === "number"
      ) {
        assert(nodeIds.has(value[0]), `${nodeId} riferisce il nodo inesistente ${value[0]}`);
      }
    }
  }
  assert.equal(prepared.apiPrompt["11"].class_type, "SaveImage");
  console.log("Krea 2 live node contract: OK (no GPU queue)");
} finally {
  library.close();
  jobs.close();
  rmSync(dataDir, { recursive: true, force: true });
}
