export type PddFamily = "ref2va" | "fl2va";

export type FastPddPair = {
  family: PddFamily;
  model: string;
  pddFile: string;
};

export const FAST_PDD_PAIRS = [
  {
    family: "ref2va",
    model: "minimax_h3_ref2va_int8_convrot.safetensors",
    pddFile: "MiniMax-H3-Ref2VA-Acc-8Step.safetensors",
  },
  {
    family: "fl2va",
    model: "minimax_h3_fl2va_int8_convrot.safetensors",
    pddFile: "MiniMax-H3-FL2VA-Acc-8Step.safetensors",
  },
] as const satisfies readonly FastPddPair[];

function baseName(name: string) {
  const normalized = name.trim().replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

export function fastPddPairForModel(model: string) {
  const filename = baseName(model);
  return FAST_PDD_PAIRS.find((pair) => pair.model.toLowerCase() === filename) ?? null;
}

export function fastPddPairForPatch(pddFile: string) {
  const filename = baseName(pddFile);
  return FAST_PDD_PAIRS.find((pair) => pair.pddFile.toLowerCase() === filename) ?? null;
}

export function isOfficialFastPddModel(model: string) {
  return fastPddPairForModel(model) !== null;
}

export function compatiblePddFilesForModel(model: string, pddFiles: readonly string[]) {
  return pddFiles.filter((pddFile) => pddModelCompatibility(model, pddFile).compatible);
}

export function preferredPddFileForModel(model: string, pddFiles: readonly string[]) {
  const pair = fastPddPairForModel(model);
  if (!pair) return null;
  return compatiblePddFilesForModel(model, pddFiles)[0] ?? pair.pddFile;
}

function familyFromName(name: string): PddFamily | null {
  const normalized = name.toLowerCase();
  const hasRef = normalized.includes("ref2va");
  const hasFl = normalized.includes("fl2va");
  if (hasRef === hasFl) return null;
  return hasRef ? "ref2va" : "fl2va";
}

const STRUCTURALLY_INCOMPATIBLE_MODEL =
  /(?:pruned|int8int4|ref[-_ ]?delta|fused|hybrid|10eros|b25[-_]?49)/i;

export function pddModelCompatibility(model: string, pddFile: string) {
  const modelPair = fastPddPairForModel(model);
  const pddPair = fastPddPairForPatch(pddFile);
  if (!modelPair) {
    const modelFamily = familyFromName(model);
    if (
      modelFamily &&
      (STRUCTURALLY_INCOMPATIBLE_MODEL.test(model) || /\.gguf$/i.test(model))
    ) {
      return {
        compatible: false,
        reason:
          "Modello FAST incompatibile con PDD-Acc: questa variante usa AdaLN pruned/8-wide. Seleziona il modello H3 INT8 ConvRot non-pruned dedicato alla stessa famiglia.",
      } as const;
    }
    return {
      compatible: false,
      reason:
        "Modello FAST non supportato: seleziona il Ref2VA o FL2VA INT8 ConvRot ufficiale non-pruned.",
    } as const;
  }
  if (!pddPair || modelPair.family !== pddPair.family) {
    return {
      compatible: false,
      reason:
        "Coppia FAST non valida: usa modello Ref2VA + PDD Ref2VA oppure modello FL2VA + PDD FL2VA; Hybrid/Ref-Delta non sono compatibili.",
    } as const;
  }
  return { compatible: true, family: modelPair.family } as const;
}

export function assertPddModelCompatibility(model: string, pddFile: string) {
  const result = pddModelCompatibility(model, pddFile);
  if (!result.compatible) throw new Error(result.reason);
  return result.family;
}
