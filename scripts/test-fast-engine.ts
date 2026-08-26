import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComfyApiPrompt } from "../bridge/comfy-client.js";
import { DEFAULT_RUNTIME_SETTINGS } from "../bridge/runtime-settings.js";
import { prepareStudioJob, publicDryRun } from "../bridge/studio-job.js";

function uniqueNode(prompt: ComfyApiPrompt, classType: string) {
  const nodes = Object.values(prompt).filter((node) => node.class_type === classType);
  assert.equal(nodes.length, 1, `Atteso un solo nodo ${classType}`);
  return nodes[0];
}

const source = JSON.parse(
  await readFile(path.resolve("workflows", "studio-backend.api.json"), "utf8"),
) as ComfyApiPrompt;

const baseRequest = {
  prompt: "A sunlit cinematic tracking shot of an adult explorer walking through a palace courtyard.",
  candidateCount: 1,
  durationSeconds: 5,
  megapixels: 0.5,
  generationMode: "T2V",
  aspectFormat: "16:9 landscape",
  seedMode: "fixed",
  seed: 12345,
};

const fast = prepareStudioJob(
  source,
  { ...baseRequest, qualityMode: "fast", turboEnabled: true },
  structuredClone(DEFAULT_RUNTIME_SETTINGS),
  "00000000-0000-4000-8000-000000000001",
);
const fastSampler = uniqueNode(fast.candidates[0].prompt, "H3ReferenceMemorySampler");
const fastShift = uniqueNode(fast.candidates[0].prompt, "MiniMaxH3SigmaShift");
assert.equal(fast.engineSettings.profile, "fast");
assert.equal(fast.engineSettings.steps, 8);
assert.equal(fastSampler.inputs.steps, 8);
assert.equal(fastSampler.inputs.sampler_name, "euler");
assert.equal(fastSampler.inputs.scheduler, "simple");
assert.equal(
  fastSampler.inputs.pdd_acc_file,
  "MiniMax-H3-Ref2VA-Acc-8Step.safetensors",
);
assert.equal(fastShift.inputs.shift_video, 12);
assert.equal(fastShift.inputs.shift_audio, 3);
assert.equal(publicDryRun(fast).fastPdd, true);

const standard8 = prepareStudioJob(
  source,
  { ...baseRequest, qualityMode: "fast", turboEnabled: false },
  structuredClone(DEFAULT_RUNTIME_SETTINGS),
  "00000000-0000-4000-8000-000000000002",
);
const standardSampler = uniqueNode(
  standard8.candidates[0].prompt,
  "H3ReferenceMemorySampler",
);
assert.equal(standard8.engineSettings.profile, "standard");
assert.equal(standard8.engineSettings.steps, 8);
assert.equal(standard8.engineSettings.pddFile, null);
assert.equal(standardSampler.inputs.steps, 8);
assert.notEqual(standardSampler.inputs.pdd_acc_file, fast.engineSettings.pddFile);

const mismatch = structuredClone(DEFAULT_RUNTIME_SETTINGS);
mismatch.fast.pddFile = "MiniMax-H3-FL2VA-Acc-8Step.safetensors";
assert.throws(
  () => prepareStudioJob(
    source,
    { ...baseRequest, qualityMode: "fast", turboEnabled: true },
    mismatch,
    "00000000-0000-4000-8000-000000000003",
  ),
  /coppia coerente/i,
);

console.log("FAST Alibaba PDD + standard 8 presets: OK (no GPU queue)");
