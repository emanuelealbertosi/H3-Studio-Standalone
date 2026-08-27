export const IMAGE_COMPOSITION_PRESETS = [
  {
    value: "free",
    label: "Libero",
    shortLabel: "Libero",
    description: "Il prompt resta invariato.",
    promptAddition: "",
  },
  {
    value: "character-turnaround",
    label: "Character sheet / turnaround",
    shortLabel: "Character sheet",
    description: "Viste coerenti fronte, tre quarti, profilo e retro.",
    promptAddition:
      "Composition: create a clean character turnaround sheet of the same character, with consistent front, three-quarter, side and back views. Show the full body in every view, in a neutral standing pose, with identical proportions, face, hairstyle and outfit. Arrange the views evenly on a simple neutral background. No text, labels, frames or cropped figures.",
  },
  {
    value: "close-up",
    label: "Primo piano",
    shortLabel: "Primo piano",
    description: "Volto dominante, testa e spalle, occhi nitidi.",
    promptAddition:
      "Composition: a close-up portrait framed around the head and shoulders. Keep the face dominant in the image, the eyes sharply focused and the facial features clearly readable. Avoid a distant or full-body framing.",
  },
  {
    value: "half-body",
    label: "Mezzo busto",
    shortLabel: "Mezzo busto",
    description: "Inquadratura dalla vita in su, posa e mani leggibili.",
    promptAddition:
      "Composition: a medium waist-up portrait. Keep the head, torso and relevant hand gestures clearly visible, with balanced space around the subject. Avoid cropping through the face or framing the subject as a distant full-body figure.",
  },
  {
    value: "full-body",
    label: "Figura intera",
    shortLabel: "Figura intera",
    description: "Soggetto completo dalla testa ai piedi, senza tagli.",
    promptAddition:
      "Composition: a full-body head-to-toe view of the subject. Keep the entire figure, including the feet, visible inside the frame with natural proportions and enough breathing room. Do not crop any part of the body.",
  },
  {
    value: "object-sheet",
    label: "Oggetto sheet",
    shortLabel: "Oggetto sheet",
    description: "Piu viste coerenti dello stesso oggetto su fondo neutro.",
    promptAddition:
      "Composition: create a clean object design sheet showing the same object consistently from front, three-quarter, side and back views, plus one useful detail view. Arrange every view evenly on a simple neutral background with consistent scale, materials and construction. No text, labels or decorative frames.",
  },
  {
    value: "landscape",
    label: "Paesaggio",
    shortLabel: "Paesaggio",
    description: "Inquadratura ampia con profondita e ambiente protagonista.",
    promptAddition:
      "Composition: a wide establishing landscape view with a clear foreground, middle ground and background. Make the environment the main subject, preserve a strong sense of scale and depth, and avoid close-up portrait framing.",
  },
] as const;

export type ImageCompositionPreset =
  (typeof IMAGE_COMPOSITION_PRESETS)[number]["value"];

const presetValues = new Set<string>(
  IMAGE_COMPOSITION_PRESETS.map((preset) => preset.value),
);

export function isImageCompositionPreset(
  value: unknown,
): value is ImageCompositionPreset {
  return typeof value === "string" && presetValues.has(value);
}

export function imageCompositionPreset(value: ImageCompositionPreset) {
  return IMAGE_COMPOSITION_PRESETS.find((preset) => preset.value === value)!;
}

export function composeImagePrompt(
  userPrompt: string,
  preset: ImageCompositionPreset,
) {
  const normalizedPrompt = userPrompt.trim();
  const addition = imageCompositionPreset(preset).promptAddition;
  if (!normalizedPrompt) return addition;
  return addition ? `${normalizedPrompt}\n\n${addition}` : normalizedPrompt;
}
