import type { ComfyClient } from "./comfy-client.js";
import {
  ChatRepository,
  type ChatActionRecord,
  type ChatAttachment,
} from "./chat-repository.js";
import type { ImageStudioService } from "./image-studio-service.js";
import type { RuntimeSettingsStore } from "./runtime-settings.js";
import type { StudioJobService } from "./studio-job.js";

type PlannedAction = {
  type: "generate_video" | "generate_image" | "edit_image" | "generate_anima";
  prompt: string;
  videoMode?: "T2V" | "I2V" | "R2V" | "VIDEO EXTENSION" | "VIDEO EDITING";
  aspect?: "16:9" | "9:16" | "1:1";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAttachment(value: unknown): ChatAttachment {
  if (!isRecord(value)) throw new Error("Allegato Chat non valido");
  const kind = value.kind === "video" || value.kind === "audio" ? value.kind : "picture";
  const file = typeof value.file === "string" ? value.file.trim() : "";
  const clean = file.replace(/ \[(input|output|temp)\]$/i, "");
  if (!file || /^[a-z]:/i.test(clean) || clean.startsWith("/") || clean.split(/[\\/]+/).includes("..")) {
    throw new Error("Percorso allegato Chat non valido");
  }
  const name = typeof value.name === "string" && value.name.trim()
    ? value.name.trim().slice(0, 240)
    : clean.split(/[\\/]/).at(-1) ?? "Media";
  const numberOrNull = (input: unknown) => {
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  return {
    kind,
    file,
    name,
    mediaPath: typeof value.mediaPath === "string" && value.mediaPath.startsWith("/api/media?")
      ? value.mediaPath.slice(0, 2_000)
      : undefined,
    width: numberOrNull(value.width),
    height: numberOrNull(value.height),
    duration: numberOrNull(value.duration),
    hasAudio: value.hasAudio === true || value.has_audio === true,
  };
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemma non ha restituito il piano JSON richiesto");
  return JSON.parse(source.slice(start, end + 1)) as unknown;
}

function normalizePlan(text: string): { reply: string; action: PlannedAction | null } {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) throw new Error("Piano Chat non valido");
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 12_000) : "";
  if (!reply) throw new Error("Risposta Chat vuota");
  if (parsed.action === null || parsed.action === undefined) return { reply, action: null };
  if (!isRecord(parsed.action)) throw new Error("Azione Chat non valida");
  const allowed = new Set(["generate_video", "generate_image", "edit_image", "generate_anima"]);
  const type = typeof parsed.action.type === "string" ? parsed.action.type : "";
  const prompt = typeof parsed.action.prompt === "string" ? parsed.action.prompt.trim() : "";
  if (!allowed.has(type) || prompt.length < 3 || prompt.length > 20_000) {
    throw new Error("Gemma ha proposto un'azione non valida");
  }
  const videoMode = ["T2V", "I2V", "R2V", "VIDEO EXTENSION", "VIDEO EDITING"].includes(String(parsed.action.videoMode))
    ? parsed.action.videoMode as PlannedAction["videoMode"]
    : undefined;
  const aspect = parsed.action.aspect === "9:16" || parsed.action.aspect === "1:1"
    ? parsed.action.aspect
    : "16:9";
  return { reply, action: { type: type as PlannedAction["type"], prompt, videoMode, aspect } };
}

const CHAT_SYSTEM_PROMPT = `You are H3 Studio, a concise Italian-speaking creative assistant and a safe workflow router.
Always return exactly one JSON object and no markdown:
{"reply":"natural Italian reply","action":null}
or
{"reply":"Italian confirmation","action":{"type":"generate_video|generate_image|edit_image|generate_anima","prompt":"complete generation prompt in English","videoMode":"T2V|I2V|R2V|VIDEO EXTENSION|VIDEO EDITING","aspect":"16:9|9:16|1:1"}}

Only create an action when the user explicitly asks to generate, animate, continue or edit media. Questions and ordinary conversation use action:null.
For video default to 10 seconds, one candidate, 0.5 MP and the FAST 8-step engine; these execution values are enforced by the server and must not be invented in JSON.
Use generate_anima for anime-style still images. Use edit_image only with attached pictures. Use I2V when one attached picture is the start frame, R2V for broader references, VIDEO EXTENSION for continuing an attached video, and VIDEO EDITING for editing one.
Write rich, production-ready prompts in English. When attachments are present, refer to them as Picture 1, Picture 2, Video 1 or Audio 1 in attachment order. Never invent file paths, model names, LoRAs, workflow nodes or numeric engine settings.`;

export class ChatService {
  constructor(
    private readonly comfy: ComfyClient,
    private readonly repository: ChatRepository,
    private readonly runtimeSettings: RuntimeSettingsStore,
    private readonly studioJobs: StudioJobService,
    private readonly imageStudio: ImageStudioService,
  ) {}

  list(projectId: string) { return this.repository.list(projectId); }
  clear(projectId: string) { return this.repository.clear(projectId); }

  async status() {
    const [settings, runtime] = await Promise.all([
      this.runtimeSettings.get(),
      this.comfy.chatStatus().catch((error) => ({
        ok: false,
        ready: false,
        loaded: false,
        models: [] as string[],
        projectors: [] as string[],
        error: error instanceof Error ? error.message : "Nodo Chat non disponibile",
      })),
    ]);
    return { ...runtime, settings: settings.chat };
  }

  async send(projectId: string, value: unknown) {
    if (!isRecord(value)) throw new Error("Messaggio Chat mancante");
    const content = typeof value.content === "string" ? value.content.trim() : "";
    if (content.length < 1 || content.length > 20_000) {
      throw new Error("Il messaggio deve contenere da 1 a 20.000 caratteri");
    }
    const rawAttachments = value.attachments === undefined ? [] : value.attachments;
    if (!Array.isArray(rawAttachments) || rawAttachments.length > 8) {
      throw new Error("Puoi allegare al massimo 8 media alla Chat");
    }
    const attachments = rawAttachments.map(normalizeAttachment);
    this.repository.add({ projectId, role: "user", content, attachments });
    const history = this.repository.list(projectId, 24);
    const settings = (await this.runtimeSettings.get()).chat;
    const modelMessages = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      ...history.map((message) => ({ role: message.role, content: message.content })),
    ];
    let rawText = "";
    try {
      const response = await this.comfy.chatGenerate({
        model: settings.model,
        projector: settings.projector,
        n_ctx: settings.nCtx,
        n_gpu_layers: settings.nGpuLayers,
        n_threads: settings.nThreads,
        max_tokens: settings.maxNewTokens,
        temperature: settings.temperature,
        top_p: settings.topP,
        messages: modelMessages,
        images: attachments.filter((item) => item.kind === "picture").map((item) => item.file).slice(0, 4),
      });
      if (!response.ok || !response.text) throw new Error(response.error ?? "Gemma 4 non ha risposto");
      rawText = response.text;
      const plan = normalizePlan(rawText);
      const action = plan.action ? await this.executeAction(projectId, plan.action, attachments) : null;
      const assistant = this.repository.add({
        projectId,
        role: "assistant",
        content: plan.reply,
        action,
      });
      return { messages: this.repository.list(projectId), assistant };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat locale non disponibile";
      const assistant = this.repository.add({
        projectId,
        role: "assistant",
        content: `Non sono riuscito a completare la richiesta: ${message}`,
        status: "failed",
        error: rawText ? `${message} · Risposta grezza: ${rawText.slice(0, 500)}` : message,
      });
      return { messages: this.repository.list(projectId), assistant };
    }
  }

  private async executeAction(
    projectId: string,
    plan: PlannedAction,
    attachments: ChatAttachment[],
  ): Promise<ChatActionRecord> {
    try {
      await this.comfy.chatUnload();
      if (plan.type === "generate_video") {
        const pictures = attachments.filter((item) => item.kind === "picture");
        const videos = attachments.filter((item) => item.kind === "video");
        let generationMode = plan.videoMode ?? "T2V";
        if (generationMode === "T2V" && pictures.length) generationMode = "I2V";
        if ((generationMode === "VIDEO EXTENSION" || generationMode === "VIDEO EDITING") && !videos.length) {
          generationMode = pictures.length ? "I2V" : "T2V";
        }
        if (generationMode === "I2V" && !pictures.length) generationMode = "T2V";
        const mediaState = generationMode === "T2V" ? [] : attachments;
        const job = await this.studioJobs.submit({
          projectId,
          prompt: plan.prompt,
          candidateCount: 1,
          durationSeconds: 10,
          megapixels: 0.5,
          generationMode,
          aspectFormat: plan.aspect === "9:16" ? "9:16 portrait" : plan.aspect === "1:1" ? "1:1 square" : "16:9 landscape",
          seedMode: "random",
          qualityMode: "fast",
          turboEnabled: true,
          mediaState: JSON.stringify(mediaState),
          referenceRoles: "AUTO",
          keyframePositions: "AUTO",
          sourceVideoAudio: "AUTO",
          muteDiegetic: false,
          muteNonDiegetic: false,
        });
        return { type: plan.type, prompt: plan.prompt, jobId: job?.id, status: "started" };
      }
      const imageMode = plan.type === "edit_image" ? "edit" : plan.type === "generate_anima" ? "anima" : "generate";
      const imageReferences = attachments.filter((item) => item.kind === "picture").slice(0, 4);
      if (imageMode === "edit" && !imageReferences.length) throw new Error("L'edit richiede almeno una immagine allegata");
      const vertical = plan.aspect === "9:16";
      const square = plan.aspect === "1:1";
      const width = square ? 1024 : vertical ? 768 : 1344;
      const height = square ? 1024 : vertical ? 1344 : 768;
      const job = await this.imageStudio.submit({
        projectId,
        mode: imageMode,
        prompt: plan.prompt,
        compositionPreset: "free",
        candidateCount: 1,
        aspectFormat: plan.aspect ?? "16:9",
        width,
        height,
        seedMode: "random",
        references: imageMode === "edit" ? imageReferences.map((item, index) => ({
          file: item.file,
          name: item.name,
          width: item.width ?? null,
          height: item.height ?? null,
          role: index === 0 ? "base" : "other",
        })) : [],
        tag: "untagged",
      });
      return { type: plan.type, prompt: plan.prompt, jobId: job?.id, status: "started" };
    } catch (error) {
      return {
        type: plan.type,
        prompt: plan.prompt,
        status: "failed",
        error: error instanceof Error ? error.message : "Avvio azione fallito",
      };
    }
  }
}
