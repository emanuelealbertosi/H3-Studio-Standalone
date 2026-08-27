import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ComfyApiNode, ComfyApiPrompt } from "./comfy-client.js";
import { FAST_PDD_PAIRS } from "./pdd-compatibility.js";
import type { WorkflowStore } from "./workflow-store.js";

function uniqueNode(prompt: ComfyApiPrompt, classType: string): ComfyApiNode {
  const matches = Object.values(prompt).filter(
    (item) => item.class_type === classType,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Workflow FAST: atteso un nodo ${classType}, trovati ${matches.length}`,
    );
  }
  return matches[0];
}

export class FastWorkflowStore {
  readonly apiPromptPath: string;

  constructor(
    private readonly source: WorkflowStore,
    outputDir: string,
  ) {
    this.apiPromptPath = path.join(outputDir, "studio-fast-pdd.api.json");
  }

  async loadApiPrompt(): Promise<ComfyApiPrompt> {
    const prompt = structuredClone(await this.source.loadApiPrompt());
    const sampler = uniqueNode(prompt, "H3ReferenceMemorySampler");
    const shift = uniqueNode(prompt, "MiniMaxH3SigmaShift");
    const model = uniqueNode(prompt, "H3ModelLoaderAny");
    model.inputs.model_name = FAST_PDD_PAIRS[0].model;
    sampler.inputs.steps = 8;
    sampler.inputs.sampler_name = "euler";
    sampler.inputs.scheduler = "simple";
    sampler.inputs.pdd_acc_file = FAST_PDD_PAIRS[0].pddFile;
    shift.inputs.shift_video = 12;
    shift.inputs.shift_audio = 3;

    await mkdir(path.dirname(this.apiPromptPath), { recursive: true });
    const temporaryPath = `${this.apiPromptPath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(prompt, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.apiPromptPath);
    return prompt;
  }

  async status() {
    try {
      await this.loadApiPrompt();
      return {
        ready: true,
        apiPromptPath: this.apiPromptPath,
        recipe: "Alibaba PDD-Acc · 8 NFE · Euler · sigmas PDD · shift 12/3 · CFG 1",
      };
    } catch (error) {
      return {
        ready: false,
        apiPromptPath: this.apiPromptPath,
        recipe: "Alibaba PDD-Acc · 8 NFE · Euler · sigmas PDD · shift 12/3 · CFG 1",
        error: error instanceof Error ? error.message : "Workflow FAST non disponibile",
      };
    }
  }
}
