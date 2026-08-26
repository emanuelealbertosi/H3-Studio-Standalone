type PddFamily = "ref2va" | "fl2va";

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
  const modelFamily = familyFromName(model);
  const pddFamily = familyFromName(pddFile);
  if (!modelFamily || !pddFamily || modelFamily !== pddFamily) {
    return {
      compatible: false,
      reason:
        "Coppia FAST non valida: usa modello Ref2VA + PDD Ref2VA oppure modello FL2VA + PDD FL2VA; Hybrid/Ref-Delta non sono compatibili.",
    } as const;
  }
  if (STRUCTURALLY_INCOMPATIBLE_MODEL.test(model) || /\.gguf$/i.test(model)) {
    return {
      compatible: false,
      reason:
        "Modello FAST incompatibile con PDD-Acc: questa variante usa AdaLN pruned/8-wide. Seleziona il modello H3 INT8 ConvRot non-pruned dedicato alla stessa famiglia.",
    } as const;
  }
  return { compatible: true, family: modelFamily } as const;
}

export function assertPddModelCompatibility(model: string, pddFile: string) {
  const result = pddModelCompatibility(model, pddFile);
  if (!result.compatible) throw new Error(result.reason);
  return result.family;
}
