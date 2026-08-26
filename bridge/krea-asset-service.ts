import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ComfyApiNode,
  ComfyApiPrompt,
  ComfyHistoryEntry,
} from "./comfy-client.js";
import type { ComfyClient } from "./comfy-client.js";
import type { CreativeLibraryRepository } from "./creative-library-repository.js";
import type {
  KreaEngineSettings,
  RuntimeSettingsStore,
} from "./runtime-settings.js";

const MAX_SEED = 9_007_199_254_740_000;
const REBALANCE_WEIGHTS = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function node(classType: string, inputs: Record<string, unknown>, title: string): ComfyApiNode {
  return { class_type: classType, inputs, _meta: { title } };
}

function normalizedSeed(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return Math.floor(Math.random() * MAX_SEED);
  }
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new Error("Seed Krea 2 non valido");
  }
  return seed;
}

function sheetPrompt(
  asset: NonNullable<ReturnType<CreativeLibraryRepository["get"]>>,
  override: unknown,
) {
  const source =
    (typeof override === "string" ? override.trim() : "") ||
    asset.generationPrompt.trim() ||
    asset.description.trim();
  if (!source) throw new Error("Descrivi prima il soggetto o l'oggetto");
  if (asset.kind === "character") {
    return `Professional cinematic character reference sheet for ${asset.name}. ${source}

Show exactly the same single adult character with perfectly consistent identity, facial structure, hairstyle, body proportions, skin tone and outfit in four clean views: full-body front view, full-body three-quarter view, side profile, and a detailed face close-up. Neutral light-gray studio background, even soft studio lighting, realistic skin and fabric texture, natural anatomy, sharp focus, photorealistic live-action look. Each panel must depict the same person. No text, no labels, no watermark, no extra people, no duplicated limbs.`;
  }
  return `Professional cinematic object reference sheet for ${asset.name}. ${source}

Show exactly the same single object with perfectly consistent design, materials, colors, scale and surface details in four clean views: front, three-quarter, side, and close-up detail. Neutral light-gray studio background, even soft product lighting, physically accurate materials, sharp focus, photorealistic product visualization. No text, no labels, no watermark, no people, no duplicate objects outside the four reference views.`;
}

function buildApiPrompt(
  prompt: string,
  seed: number,
  filenamePrefix: string,
  settings: KreaEngineSettings,
): ComfyApiPrompt {
  const apiPrompt: ComfyApiPrompt = {
    "1": node(
      "UNETLoader",
      { unet_name: settings.model, weight_dtype: "default" },
      "Krea 2 Turbo model",
    ),
    "2": node(
      "CLIPLoader",
      { clip_name: settings.encoder, type: "krea2", device: "default" },
      "Krea 2 text encoder",
    ),
    "3": node("VAELoader", { vae_name: settings.vae }, "Krea 2 VAE"),
    "4": node("CLIPTextEncode", { text: prompt, clip: ["2", 0] }, "Sheet prompt"),
    "5": node(
      "ConditioningKrea2Rebalance",
      {
        conditioning: ["4", 0],
        multiplier: 3,
        per_layer_weights: REBALANCE_WEIGHTS,
      },
      "Krea 2 conditioning rebalance",
    ),
    "6": node(
      "ConditioningZeroOut",
      { conditioning: ["4", 0] },
      "Zero negative conditioning",
    ),
    "7": node(
      "EmptyLatentImage",
      { width: 1536, height: 1024, batch_size: 1 },
      "Character sheet canvas",
    ),
  };
  let modelInput: [string, number] = ["1", 0];
  settings.loras.forEach((lora, index) => {
    const id = String(20 + index);
    apiPrompt[id] = node(
      "LoraLoaderModelOnly",
      {
        model: modelInput,
        lora_name: lora.name,
        strength_model: lora.strength,
      },
      `Krea LoRA ${index + 1}`,
    );
    modelInput = [id, 0];
  });
  apiPrompt["8"] = node(
      "KSampler",
      {
        model: modelInput,
        seed,
        steps: settings.steps,
        cfg: 1,
        sampler_name: "er_sde",
        scheduler: "simple",
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
        denoise: 1,
      },
      "Krea 2 sheet sampler",
    );
  apiPrompt["9"] = node(
      "VAEDecode",
      { samples: ["8", 0], vae: ["3", 0] },
      "Decode sheet",
    );
  apiPrompt["10"] = node(
      "ImageSharpenKJ",
      { image: ["9", 0], method: "rcas", "method.strength": 0.55 },
      "Sheet detail recovery",
    );
  apiPrompt["11"] = node(
      "SaveImage",
      { images: ["10", 0], filename_prefix: filenamePrefix },
      "Save Krea 2 sheet",
    );
  return apiPrompt;
}

function findImageOutput(entry: ComfyHistoryEntry) {
  if (!isRecord(entry.outputs)) return null;
  for (const output of Object.values(entry.outputs)) {
    if (!isRecord(output)) continue;
    for (const value of Object.values(output)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!isRecord(item) || typeof item.filename !== "string") continue;
        if (!/\.(png|jpe?g|webp)$/i.test(item.filename)) continue;
        const type: "input" | "output" | "temp" =
          item.type === "input" || item.type === "temp" ? item.type : "output";
        return {
          filename: item.filename,
          subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
          type,
          format:
            typeof item.format === "string" && item.format.startsWith("image/")
              ? item.format
              : "image/png",
        };
      }
    }
  }
  return null;
}

export class KreaAssetService {
  constructor(
    private readonly comfy: ComfyClient,
    private readonly library: CreativeLibraryRepository,
    private readonly sourceWorkflowPath: string,
    private readonly runtimeSettings: RuntimeSettingsStore,
  ) {}

  async prepare(assetId: string, raw: { prompt?: unknown; seed?: unknown } = {}) {
    const asset = this.library.get(assetId);
    if (!asset) throw new Error("Asset non trovato");
    const settings = (await this.runtimeSettings.get()).krea;
    const id = randomUUID();
    const prompt = sheetPrompt(asset, raw.prompt);
    const seed = normalizedSeed(raw.seed);
    const filenamePrefix = `images/H3_STUDIO/library/${asset.id}/krea_sheet_${id.slice(0, 8)}`;
    const apiPrompt = buildApiPrompt(prompt, seed, filenamePrefix, settings);
    return { id, assetId, prompt, seed, filenamePrefix, apiPrompt, settings };
  }

  async dryRun(assetId: string, raw: { prompt?: unknown; seed?: unknown } = {}) {
    const prepared = await this.prepare(assetId, raw);
    return {
      ok: true,
      dryRun: true,
      engine: "Krea 2 configurabile",
      model: prepared.settings.model,
      encoder: prepared.settings.encoder,
      vae: prepared.settings.vae,
      loras: prepared.settings.loras,
      width: 1536,
      height: 1024,
      steps: prepared.settings.steps,
      cfg: 1,
      seed: prepared.seed,
      prompt: prepared.prompt,
      apiNodeCount: Object.keys(prepared.apiPrompt).length,
      filenamePrefix: prepared.filenamePrefix,
    };
  }

  async submit(assetId: string, raw: { prompt?: unknown; seed?: unknown } = {}) {
    const prepared = await this.prepare(assetId, raw);
    this.library.createGeneration(assetId, prepared);
    try {
      const queued = await this.comfy.queuePrompt(
        prepared.apiPrompt,
        `h3-studio-krea-${prepared.id}`,
      );
      this.library.markGenerationQueued(prepared.id, queued.promptId, queued.queueNumber);
      return this.library.get(assetId)!;
    } catch (error) {
      this.library.markGenerationFailed(
        prepared.id,
        error instanceof Error ? error.message : "Invio Krea 2 fallito",
      );
      throw error;
    }
  }

  async sync() {
    const pending = this.library.pendingGenerations();
    if (pending.length === 0) return;
    const [history, queue] = await Promise.all([
      this.comfy.history(200),
      this.comfy.queueState(),
    ]);
    for (const generation of pending) {
      if (!generation.prompt_id) continue;
      const entry = history[generation.prompt_id];
      const output = entry ? findImageOutput(entry) : null;
      if (output) {
        this.library.markGenerationReady(generation.id, output);
        continue;
      }
      if (queue.runningPromptIds.has(generation.prompt_id)) {
        this.library.markGenerationRunning(generation.id);
        continue;
      }
      const status = entry?.status;
      if (isRecord(status) && status.status_str === "error") {
        this.library.markGenerationFailed(generation.id, "ComfyUI ha interrotto la generazione");
      }
    }
  }

  async status() {
    const settings = (await this.runtimeSettings.get()).krea;
    const [models, encoders, vaes, loras, rebalance, sharpen, loraLoader] = await Promise.all([
      this.comfy.modelFiles("diffusion_models"),
      this.comfy.modelFiles("text_encoders"),
      this.comfy.modelFiles("vae"),
      this.comfy.modelFiles("loras"),
      this.comfy.objectInfo("ConditioningKrea2Rebalance"),
      this.comfy.objectInfo("ImageSharpenKJ"),
      this.comfy.objectInfo("LoraLoaderModelOnly"),
    ]);
    const checks = {
      sourceWorkflow: existsSync(this.sourceWorkflowPath),
      model: models.includes(settings.model),
      encoder: encoders.includes(settings.encoder),
      vae: vaes.includes(settings.vae),
      loras: settings.loras.every((slot) => loras.includes(slot.name)),
      loraLoaderNode:
        settings.loras.length === 0 || Boolean(loraLoader.LoraLoaderModelOnly),
      rebalanceNode: Boolean(rebalance.ConditioningKrea2Rebalance),
      sharpenNode: Boolean(sharpen.ImageSharpenKJ),
    };
    return {
      ready: Object.values(checks).every(Boolean),
      checks,
      sourceWorkflow: this.sourceWorkflowPath,
      engine: {
        ...settings,
        size: "1536×1024",
      },
    };
  }
}
