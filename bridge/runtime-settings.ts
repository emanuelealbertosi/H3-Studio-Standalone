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

export type RuntimeSettings = {
  h3: H3EngineSettings;
  fast: FastEngineSettings;
  krea: KreaEngineSettings;
};

export type ResolvedEngineSettings = H3EngineSettings & {
  profile: "standard" | "fast";
  pddFile: string | null;
  /** Legacy summary fields kept for existing job records and clients. */
  lora: string;
  loraStrength: number;
};

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

  const h3Model = typeof value.h3.model === "string" ? value.h3.model.trim() : "";
  const fastModel = typeof fast.model === "string" ? fast.model.trim() : "";
  const pddFile = typeof fast.pddFile === "string" ? fast.pddFile.trim() : "";
  const kreaModel = typeof value.krea.model === "string" ? value.krea.model.trim() : "";
  const encoder = typeof value.krea.encoder === "string" ? value.krea.encoder.trim() : "";
  const vae = typeof value.krea.vae === "string" ? value.krea.vae.trim() : "";
  if (!h3Model) throw new Error("Seleziona un modello H3");
  if (!fastModel) throw new Error("Seleziona un modello FAST H3");
  if (!pddFile) throw new Error("Seleziona l'acceleratore PDD Alibaba per FAST");
  if (!kreaModel) throw new Error("Seleziona un modello Krea");
  if (!encoder) throw new Error("Seleziona il text encoder Krea");
  if (!vae) throw new Error("Seleziona la VAE Krea");
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
    const settings = validateSettings(value);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
    return settings;
  }
}
