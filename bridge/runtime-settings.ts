import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPddModelCompatibility,
  FAST_PDD_PAIRS,
} from "./pdd-compatibility.js";

export type EngineLoraSettings = {
  name: string;
  strength: number;
};

export type H3EngineSettings = {
  model: string;
  loras: EngineLoraSettings[];
  steps: number;
};

export type FastEngineSettings = {
  model: string;
  pddFile: string;
  loras: EngineLoraSettings[];
  steps: 8;
};

export type KreaEngineSettings = {
  model: string;
  encoder: string;
  vae: string;
  loras: EngineLoraSettings[];
  steps: number;
};

export type ImageEditEngineSettings = {
  model: string;
  encoder: string;
  vae: string;
  steps: number;
  cfg: number;
  kvCacheEnabled: boolean;
  attentionBackend:
    | "auto"
    | "pytorch attention"
    | "comfy kitchen attention";
};

export type AnimaEngineSettings = {
  model: string;
  encoder: string;
  vae: string;
  loras: EngineLoraSettings[];
  steps: number;
  cfg: number;
};

export type RuntimeSettings = {
  h3: H3EngineSettings;
  fast: FastEngineSettings;
  krea: KreaEngineSettings;
  imageEdit: ImageEditEngineSettings;
  anima: AnimaEngineSettings;
};

export type ResolvedEngineSettings = H3EngineSettings & {
  profile: "standard" | "fast";
  pddFile: string | null;
  /** Legacy summary fields kept for existing job records and clients. */
  lora: string;
  loraStrength: number;
};

export function isFlux2KleinModelFilename(value: string) {
  return /(?:flux.*2.*klein|klein.*flux|unstable.*f2k|snofs)/i.test(value);
}

export function isFlux2Klein9BModelFilename(value: string) {
  return /(?:9b|snofs)/i.test(value);
}

export function isAnimaModelFilename(value: string) {
  return /(?:anima|nova.*am)/i.test(value);
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = Object.freeze({
  h3: {
    model: "minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors",
    loras: [],
    steps: 8,
  },
  fast: {
    model: FAST_PDD_PAIRS[0].model,
    pddFile: FAST_PDD_PAIRS[0].pddFile,
    loras: [],
    steps: 8,
  },
  krea: {
    model: "krea2TurboFP8_krea2TURBO.safetensors",
    encoder: "qwen3vl_4b_fp8_scaled.safetensors",
    vae: "qwen_image_vae.safetensors",
    loras: [],
    steps: 8,
  },
  imageEdit: {
    model: "flux-2-klein-4b-fp8.safetensors",
    encoder: "qwen_3_4b.safetensors",
    vae: "flux2-vae.safetensors",
    steps: 4,
    cfg: 1,
    kvCacheEnabled: false,
    attentionBackend: "auto",
  },
  anima: {
    model: "anima_turboV10.safetensors",
    encoder: "anima_baseV10_txt.safetensors",
    vae: "qwen_image_vae.safetensors",
    loras: [],
    steps: 8,
    cfg: 1,
  },
});

function cloneDefaults(): RuntimeSettings {
  return {
    h3: {
      ...DEFAULT_RUNTIME_SETTINGS.h3,
      loras: DEFAULT_RUNTIME_SETTINGS.h3.loras.map((slot) => ({ ...slot })),
    },
    fast: {
      ...DEFAULT_RUNTIME_SETTINGS.fast,
      loras: DEFAULT_RUNTIME_SETTINGS.fast.loras.map((slot) => ({ ...slot })),
    },
    krea: {
      ...DEFAULT_RUNTIME_SETTINGS.krea,
      loras: DEFAULT_RUNTIME_SETTINGS.krea.loras.map((slot) => ({ ...slot })),
    },
    imageEdit: {
      ...DEFAULT_RUNTIME_SETTINGS.imageEdit,
    },
    anima: {
      ...DEFAULT_RUNTIME_SETTINGS.anima,
      loras: DEFAULT_RUNTIME_SETTINGS.anima.loras.map((slot) => ({ ...slot })),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLoras(value: unknown, label: string): EngineLoraSettings[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`I LoRA ${label} non sono validi`);
  if (value.length > 3) throw new Error(`Puoi configurare al massimo 3 LoRA ${label}`);
  const result: EngineLoraSettings[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) throw new Error(`Slot LoRA ${label} non valido`);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const strength = Number(item.strength);
    if (!Number.isFinite(strength) || strength < -2 || strength > 2) {
      throw new Error(`La strength dei LoRA ${label} deve essere compresa fra -2 e 2`);
    }
    if (names.has(name)) throw new Error(`Il LoRA ${name} è selezionato più di una volta`);
    names.add(name);
    result.push({ name, strength });
  }
  return result;
}

function validateStepCount(value: unknown, label: string) {
  const steps = Number(value);
  if (!Number.isInteger(steps) || steps < 4 || steps > 40) {
    throw new Error(`Gli step ${label} devono essere un intero fra 4 e 40`);
  }
  return steps;
}

function migrateLegacySettings(value: Record<string, unknown>): RuntimeSettings | null {
  if (isRecord(value.h3) || isRecord(value.krea)) return null;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model) return null;
  const lora = typeof value.lora === "string" ? value.lora.trim() : "";
  const loraStrength = Number(value.loraStrength);
  const defaults = cloneDefaults();
  return {
    h3: {
      model,
      loras: lora
        ? [{ name: lora, strength: Number.isFinite(loraStrength) ? loraStrength : 1 }]
        : [],
      steps: validateStepCount(value.steps ?? defaults.h3.steps, "H3"),
    },
    fast: defaults.fast,
    krea: defaults.krea,
    imageEdit: defaults.imageEdit,
    anima: defaults.anima,
  };
}

function validateSettings(value: unknown): RuntimeSettings {
  if (!isRecord(value)) throw new Error("Impostazioni Engine mancanti");
  const migrated = migrateLegacySettings(value);
  if (migrated) return migrated;
  if (!isRecord(value.h3) || !isRecord(value.krea)) {
    throw new Error("Configurazione H3 o Krea mancante");
  }

  const defaults = cloneDefaults();
  const fast = isRecord(value.fast) ? value.fast : defaults.fast;
  const imageEdit = isRecord(value.imageEdit) ? value.imageEdit : defaults.imageEdit;
  const anima = isRecord(value.anima) ? value.anima : defaults.anima;

  const h3Model = typeof value.h3.model === "string" ? value.h3.model.trim() : "";
  const fastModel = typeof fast.model === "string" ? fast.model.trim() : "";
  const pddFile = typeof fast.pddFile === "string" ? fast.pddFile.trim() : "";
  const kreaModel = typeof value.krea.model === "string" ? value.krea.model.trim() : "";
  const encoder = typeof value.krea.encoder === "string" ? value.krea.encoder.trim() : "";
  const vae = typeof value.krea.vae === "string" ? value.krea.vae.trim() : "";
  const imageEditModel =
    typeof imageEdit.model === "string" ? imageEdit.model.trim() : "";
  const imageEditEncoder =
    typeof imageEdit.encoder === "string" ? imageEdit.encoder.trim() : "";
  const imageEditVae =
    typeof imageEdit.vae === "string" ? imageEdit.vae.trim() : "";
  const imageEditCfg = Number(imageEdit.cfg);
  const animaModel = typeof anima.model === "string" ? anima.model.trim() : "";
  const animaEncoder = typeof anima.encoder === "string" ? anima.encoder.trim() : "";
  const animaVae = typeof anima.vae === "string" ? anima.vae.trim() : "";
  const animaCfg = Number(anima.cfg);
  const imageEditKvCache =
    imageEdit.kvCacheEnabled === undefined
      ? defaults.imageEdit.kvCacheEnabled
      : imageEdit.kvCacheEnabled === true;
  const imageEditAttention =
    imageEdit.attentionBackend === "pytorch attention" ||
    imageEdit.attentionBackend === "comfy kitchen attention"
      ? imageEdit.attentionBackend
      : "auto";
  if (!h3Model) throw new Error("Seleziona un modello H3");
  if (!fastModel) throw new Error("Seleziona un modello FAST H3");
  if (!pddFile) throw new Error("Seleziona l'acceleratore PDD Alibaba per FAST");
  if (!kreaModel) throw new Error("Seleziona un modello Krea");
  if (!encoder) throw new Error("Seleziona il text encoder Krea");
  if (!vae) throw new Error("Seleziona la VAE Krea");
  if (!imageEditModel) throw new Error("Seleziona un modello Flux.2 Klein Edit");
  if (!isFlux2KleinModelFilename(imageEditModel)) {
    throw new Error(
      `Il modello ${imageEditModel} non è compatibile con Flux.2 Klein Edit`,
    );
  }
  if (!imageEditEncoder) throw new Error("Seleziona il text encoder Flux.2 Klein Edit");
  const expectedEncoderSize = isFlux2Klein9BModelFilename(imageEditModel)
    ? "8B"
    : "4B";
  const encoderPattern = expectedEncoderSize === "8B"
    ? /qwen.*3.*8b/i
    : /qwen.*3.*4b/i;
  if (!encoderPattern.test(imageEditEncoder)) {
    throw new Error(
      `Il modello ${imageEditModel} richiede un text encoder Qwen 3 ${expectedEncoderSize}`,
    );
  }
  if (!imageEditVae) throw new Error("Seleziona la VAE Flux.2 Klein Edit");
  if (!Number.isFinite(imageEditCfg) || imageEditCfg < 0 || imageEditCfg > 20) {
    throw new Error("Il CFG Flux.2 Klein Edit deve essere compreso fra 0 e 20");
  }
  if (!animaModel) throw new Error("Seleziona un modello Anima");
  if (!isAnimaModelFilename(animaModel)) {
    throw new Error(`Il modello ${animaModel} non sembra compatibile con Anima`);
  }
  if (!animaEncoder) throw new Error("Seleziona il text encoder Anima");
  if (!animaVae) throw new Error("Seleziona la VAE Anima");
  if (!Number.isFinite(animaCfg) || animaCfg < 0 || animaCfg > 20) {
    throw new Error("Il CFG Anima deve essere compreso fra 0 e 20");
  }
  assertPddModelCompatibility(fastModel, pddFile);

  return {
    h3: {
      model: h3Model,
      loras: validateLoras(value.h3.loras, "H3"),
      steps: validateStepCount(value.h3.steps, "H3"),
    },
    fast: {
      model: fastModel,
      pddFile,
      loras: validateLoras(fast.loras, "FAST"),
      steps: 8,
    },
    krea: {
      model: kreaModel,
      encoder,
      vae,
      loras: validateLoras(value.krea.loras, "Krea"),
      steps: validateStepCount(value.krea.steps, "Krea"),
    },
    imageEdit: {
      model: imageEditModel,
      encoder: imageEditEncoder,
      vae: imageEditVae,
      steps: validateStepCount(imageEdit.steps, "Flux.2 Klein Edit"),
      cfg: imageEditCfg,
      kvCacheEnabled: imageEditKvCache,
      attentionBackend: imageEditAttention,
    },
    anima: {
      model: animaModel,
      encoder: animaEncoder,
      vae: animaVae,
      loras: validateLoras(anima.loras, "Anima"),
      steps: validateStepCount(anima.steps, "Anima"),
      cfg: animaCfg,
    },
  };
}

export class RuntimeSettingsStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "runtime-settings.json");
  }

  async get(): Promise<RuntimeSettings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      return validateSettings(parsed);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return cloneDefaults();
      }
      if (error instanceof SyntaxError) {
        throw new Error("Il file runtime-settings.json non contiene JSON valido");
      }
      throw error;
    }
  }

  async update(value: unknown) {
    const current = await this.get();
    const settings = isRecord(value)
      ? validateSettings({
          ...value,
          imageEdit: isRecord(value.imageEdit) ? value.imageEdit : current.imageEdit,
          anima: isRecord(value.anima) ? value.anima : current.anima,
        })
      : validateSettings(value);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
    return settings;
  }
}
