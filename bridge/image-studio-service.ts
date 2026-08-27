import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  ComfyApiPrompt,
  ComfyClient,
  ComfyHistoryEntry,
} from "./comfy-client.js";
import {
  type ImageJobMode,
  ImageJobRepository,
  type ImageJobReferenceInput,
  type ImageProjectTag,
  type ImageReferenceRole,
  type ImageSeedMode,
  type PreparedImageJob,
} from "./image-job-repository.js";
import {
  assertImageDimensions,
  buildFlux2KleinEditPrompt,
  buildKreaGeneratePrompt,
  IMAGE_API_MAX_PIXELS,
  IMAGE_EDIT_MAX_REFERENCES,
  IMAGE_UI_TARGET_MAX_PIXELS,
} from "./image-workflow-builder.js";
import type { RuntimeSettingsStore } from "./runtime-settings.js";
import type { ComfyProgressTracker } from "./comfy-progress.js";

const MAX_SEED = 9_007_199_254_740_000;
const referenceRoles = new Set<ImageReferenceRole>([
  "base",
  "subject",
  "style",
  "pose",
  "background",
  "other",
]);
const projectTags = new Set<ImageProjectTag>([
  "untagged",
  "character",
  "object",
  "background",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomSeed() {
  return Math.floor(Math.random() * MAX_SEED);
}

function normalizeFile(value: unknown) {
  const file = typeof value === "string"
    ? value.trim().replaceAll(String.fromCharCode(92), "/")
    : "";
  const suffix = [" [input]", " [output]", " [temp]"].find((candidate) =>
    file.toLowerCase().endsWith(candidate),
  );
  const clean = suffix ? file.slice(0, -suffix.length) : file;
  if (
    !file ||
    file.length > 1_024 ||
    /^[a-z]:/i.test(clean) ||
    clean.startsWith("/") ||
    clean.split("/").includes("..")
  ) {
    throw new Error("Percorso reference immagine non valido");
  }
  return file;
}

function normalizeReference(
  value: unknown,
  index: number,
): ImageJobReferenceInput {
  if (!isRecord(value)) throw new Error(`Reference ${index + 1} non valida`);
  const file = normalizeFile(value.file);
  const suffix = [" [input]", " [output]", " [temp]"].find((candidate) =>
    file.toLowerCase().endsWith(candidate),
  );
  const clean = suffix ? file.slice(0, -suffix.length) : file;
  const fallbackName = clean.slice(clean.lastIndexOf("/") + 1);
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 240)
      : fallbackName;
  const requestedRole = typeof value.role === "string" ? value.role : "";
  const role = referenceRoles.has(requestedRole as ImageReferenceRole)
    ? (requestedRole as ImageReferenceRole)
    : index === 0
      ? "base"
      : "other";
  const width = value.width === undefined || value.width === null
    ? null
    : Number(value.width);
  const height = value.height === undefined || value.height === null
    ? null
    : Number(value.height);
  if (width !== null && (!Number.isInteger(width) || width <= 0)) {
    throw new Error(`Larghezza reference ${index + 1} non valida`);
  }
  if (height !== null && (!Number.isInteger(height) || height <= 0)) {
    throw new Error(`Altezza reference ${index + 1} non valida`);
  }
  return { file, name, role, width, height };
}

function normalizeRequest(value: unknown) {
  if (!isRecord(value)) throw new Error("Body immagine mancante");
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  if (!projectId) throw new Error("Seleziona un progetto");
  const mode: ImageJobMode = value.mode === "edit" ? "edit" : "generate";
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 20_000) {
    throw new Error("Il prompt immagine deve contenere da 3 a 20.000 caratteri");
  }
  const candidateCount = Number(value.candidateCount);
  if (![1, 2, 3, 4].includes(candidateCount)) {
    throw new Error("candidateCount deve essere 1, 2, 3 o 4");
  }
  const width = Number(value.width);
  const height = Number(value.height);
  assertImageDimensions(width, height);
  const aspectFormat =
    typeof value.aspectFormat === "string" && value.aspectFormat.trim()
      ? value.aspectFormat.trim().slice(0, 60)
      : `${width}:${height}`;
  const seedMode: ImageSeedMode =
    value.seedMode === "base" || value.seedMode === "fixed"
      ? value.seedMode
      : "random";
  const requestedSeed =
    value.seed === undefined || value.seed === null || value.seed === ""
      ? null
      : Number(value.seed);
  if (
    requestedSeed !== null &&
    (!Number.isSafeInteger(requestedSeed) ||
      requestedSeed < 0 ||
      requestedSeed >= MAX_SEED)
  ) {
    throw new Error("Il seed immagine deve essere un intero sicuro maggiore o uguale a zero");
  }
  if (seedMode !== "random" && requestedSeed === null) {
    throw new Error("Inserisci un seed per la modalità base o bloccata");
  }
  const rawReferences = value.references === undefined ? [] : value.references;
  if (!Array.isArray(rawReferences)) throw new Error("Le reference devono essere un array");
  if (rawReferences.length > IMAGE_EDIT_MAX_REFERENCES) {
    throw new Error("Flux.2 Klein Edit supporta al massimo 4 reference");
  }
  if (mode === "edit" && rawReferences.length === 0) {
    throw new Error("La modalità Edit richiede almeno una reference");
  }
  if (mode === "generate" && rawReferences.length > 0) {
    throw new Error("Le reference si usano in modalità Edit");
  }
  const references = rawReferences.map(normalizeReference);
  const requestedTag = typeof value.tag === "string" ? value.tag : "";
  const tag = projectTags.has(requestedTag as ImageProjectTag)
    ? (requestedTag as ImageProjectTag)
    : "untagged";
  return {
    projectId,
    mode,
    prompt,
    candidateCount: candidateCount as 1 | 2 | 3 | 4,
    width,
    height,
    aspectFormat,
    seedMode,
    requestedSeed,
    references,
    tag,
  };
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

function objectInfoContains(value: unknown, className: string) {
  return isRecord(value) && isRecord(value[className]);
}

function objectInfoOptions(
  value: unknown,
  className: string,
  inputName: string,
) {
  if (!isRecord(value) || !isRecord(value[className])) return [];
  const input = value[className].input;
  if (!isRecord(input) || !isRecord(input.required)) return [];
  const descriptor = input.required[inputName];
  if (!Array.isArray(descriptor) || !Array.isArray(descriptor[0])) return [];
  return descriptor[0].filter((item): item is string => typeof item === "string");
}

async function readWorkflowTemplate(filePath: string): Promise<ComfyApiPrompt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "file non leggibile";
    throw new Error(`Workflow immagini non disponibile: ${detail}`);
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("Il workflow immagini selezionato non contiene un prompt API valido");
  }
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value) || typeof value.class_type !== "string" || !isRecord(value.inputs)) {
      throw new Error(`Nodo ${id} non valido nel workflow immagini selezionato`);
    }
  }
  return parsed as ComfyApiPrompt;
}

export class ImageStudioService {
  constructor(
    private readonly comfy: ComfyClient,
    private readonly repository: ImageJobRepository,
    private readonly runtimeSettings: RuntimeSettingsStore,
    private readonly generateWorkflowPath: string,
    private readonly editWorkflowPath: string,
    private readonly progressTracker?: ComfyProgressTracker,
  ) {}

  async prepare(value: unknown): Promise<PreparedImageJob> {
    const request = normalizeRequest(value);
    const [settings, workflowTemplate] = await Promise.all([
      this.runtimeSettings.get(),
      readWorkflowTemplate(
        request.mode === "edit" ? this.editWorkflowPath : this.generateWorkflowPath,
      ),
    ]);
    const id = randomUUID();
    const baseSeed = request.requestedSeed ?? randomSeed();
    const usedRandomSeeds = new Set<number>();
    const engine = request.mode === "edit"
      ? {
          kind: "flux2-klein-edit" as const,
          model: settings.imageEdit.model,
          encoder: settings.imageEdit.encoder,
          vae: settings.imageEdit.vae,
          steps: settings.imageEdit.steps,
          cfg: settings.imageEdit.cfg,
          sampler: "euler",
          scheduler: "flux2",
          kvCacheEnabled: settings.imageEdit.kvCacheEnabled,
          attentionBackend: settings.imageEdit.attentionBackend,
        }
      : {
          kind: "krea" as const,
          model: settings.krea.model,
          encoder: settings.krea.encoder,
          vae: settings.krea.vae,
          steps: settings.krea.steps,
          cfg: 1,
          sampler: "er_sde",
          scheduler: "simple",
          loras: settings.krea.loras,
        };
    const candidates = Array.from({ length: request.candidateCount }, (_, offset) => {
      const index = offset + 1;
      let seed: number;
      if (request.seedMode === "fixed") seed = baseSeed;
      else if (request.seedMode === "base") seed = (baseSeed + offset) % MAX_SEED;
      else {
        do seed = randomSeed();
        while (usedRandomSeeds.has(seed));
        usedRandomSeeds.add(seed);
      }
      const filenamePrefix =
        `images/H3_STUDIO/projects/${request.projectId}/${request.mode}_${id.slice(0, 8)}_c${index}`;
      const apiPrompt = request.mode === "edit"
        ? buildFlux2KleinEditPrompt({
            prompt: request.prompt,
            seed,
            width: request.width,
            height: request.height,
            filenamePrefix,
            settings: settings.imageEdit,
            references: request.references,
            template: workflowTemplate,
          })
        : buildKreaGeneratePrompt({
            prompt: request.prompt,
            seed,
            width: request.width,
            height: request.height,
            filenamePrefix,
            settings: settings.krea,
            template: workflowTemplate,
          });
      return { index, seed, filenamePrefix, apiPrompt };
    });
    return {
      id,
      originProjectId: request.projectId,
      mode: request.mode,
      prompt: request.prompt,
      candidateCount: request.candidateCount,
      aspectFormat: request.aspectFormat,
      width: request.width,
      height: request.height,
      seedMode: request.seedMode,
      requestedSeed: request.requestedSeed,
      tag: request.tag,
      engine,
      references: request.references,
      candidates,
    };
  }

  async dryRun(value: unknown) {
    const prepared = await this.prepare(value);
    return {
      ok: true,
      dryRun: true,
      job: {
        ...prepared,
        candidates: prepared.candidates.map((candidate) => ({
          index: candidate.index,
          seed: candidate.seed,
          filenamePrefix: candidate.filenamePrefix,
          apiNodeCount: Object.keys(candidate.apiPrompt).length,
        })),
      },
    };
  }

  async submit(value: unknown) {
    const prepared = await this.prepare(value);
    this.repository.createPrepared(prepared);
    for (const candidate of prepared.candidates) {
      try {
        const queued = await this.comfy.queuePrompt(
          candidate.apiPrompt,
          `h3-studio-image-${prepared.id}-${candidate.index}`,
        );
        this.repository.markQueued(
          prepared.id,
          candidate.index,
          queued.promptId,
          queued.queueNumber,
        );
        this.progressTracker?.register(
          queued.promptId,
          candidate.apiPrompt,
          "image",
        );
      } catch (error) {
        this.repository.markCandidateStatus(
          prepared.id,
          candidate.index,
          "failed",
          null,
          error instanceof Error ? error.message : "Invio immagine a ComfyUI fallito",
        );
      }
    }
    return this.present(this.repository.get(prepared.id)!);
  }

  async sync() {
    const pending = this.repository.pendingCandidates();
    if (pending.length === 0) return 0;
    const [history, queue] = await Promise.all([
      this.comfy.history(200),
      this.comfy.queueState(),
    ]);
    for (const candidate of pending) {
      if (!candidate.prompt_id) continue;
      const entry = history[candidate.prompt_id];
      const output = entry ? findImageOutput(entry) : null;
      if (output) {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "ready",
          output,
        );
        continue;
      }
      if (queue.runningPromptIds.has(candidate.prompt_id)) {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "running",
        );
        continue;
      }
      if (queue.pendingPromptIds.has(candidate.prompt_id)) {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "queued",
        );
        continue;
      }
      const status = entry?.status;
      if (isRecord(status) && status.status_str === "error") {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "failed",
          null,
          "ComfyUI ha interrotto la generazione immagine",
        );
        continue;
      }
      if (
        isRecord(status) &&
        (status.status_str === "success" || status.status_str === "completed")
      ) {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "failed",
          null,
          "ComfyUI ha completato il prompt senza produrre un output immagine",
        );
        continue;
      }
      if (
        !entry &&
        Date.now() - Date.parse(candidate.updated_at) > 30_000
      ) {
        this.repository.markCandidateStatus(
          candidate.job_id,
          candidate.candidate_index,
          "failed",
          null,
          "Il prompt non è più presente nella coda o nella history ComfyUI",
        );
      }
    }
    return pending.length;
  }

  async recover() {
    for (const candidate of this.repository.pendingCandidates()) {
      if (!candidate.prompt_id) continue;
      try {
        this.progressTracker?.register(
          candidate.prompt_id,
          JSON.parse(candidate.api_prompt_json),
          "image",
        );
      } catch {
        // A malformed historical prompt must not block bridge startup.
      }
    }
    return this.sync().catch(() => 0);
  }

  async get(jobId: string) {
    await this.sync().catch(() => undefined);
    const job = this.repository.get(jobId);
    return job ? this.present(job) : null;
  }

  async list(limit: number, projectId?: string | null) {
    await this.sync().catch(() => undefined);
    return this.repository.list(limit, projectId).map((job) => this.present(job));
  }

  async cancel(jobId: string) {
    if (!this.repository.get(jobId)) return null;
    await this.comfy.cancelPrompts(this.repository.promptIds(jobId));
    this.repository.markCancelled(jobId);
    const job = this.repository.get(jobId);
    return job ? this.present(job) : null;
  }

  select(jobId: string, candidateIndex: number) {
    return this.present(this.repository.select(jobId, candidateIndex));
  }

  linkProject(
    jobId: string,
    candidateIndex: number,
    projectId: string,
    tag: ImageProjectTag,
  ) {
    if (!projectTags.has(tag)) throw new Error("Tag immagine non valido");
    return this.present(
      this.repository.linkProject(jobId, candidateIndex, projectId, tag),
    );
  }

  unlinkProject(jobId: string, candidateIndex: number, projectId: string) {
    return this.present(
      this.repository.unlinkProject(jobId, candidateIndex, projectId),
    );
  }

  deleteCandidate(jobId: string, candidateIndex: number) {
    return this.repository.deleteCandidate(jobId, candidateIndex);
  }

  async summary() {
    const settings = await this.runtimeSettings.get();
    return {
      generate: {
        kind: "krea",
        model: settings.krea.model,
        steps: settings.krea.steps,
      },
      edit: {
        kind: "flux2-klein-edit",
        ...settings.imageEdit,
        maxReferences: IMAGE_EDIT_MAX_REFERENCES,
      },
      limits: {
        uiTargetMaxPixels: IMAGE_UI_TARGET_MAX_PIXELS,
        apiMaxPixels: IMAGE_API_MAX_PIXELS,
        sizeMultiple: 16,
      },
      storage: this.repository.stats(),
    };
  }

  async attentionBackends() {
    const info = await this.comfy.objectInfo("ModelAttentionBackend");
    return objectInfoOptions(info, "ModelAttentionBackend", "attention");
  }

  async status() {
    const settings = await this.runtimeSettings.get();
    const classNames = [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "CLIPTextEncode",
      "ConditioningZeroOut",
      "EmptyFlux2LatentImage",
      "RandomNoise",
      "CFGGuider",
      "KSamplerSelect",
      "Flux2Scheduler",
      "SamplerCustomAdvanced",
      "VAEDecode",
      "SaveImage",
      "LoadImage",
      "ImageScaleToTotalPixels",
      "VAEEncode",
      "ReferenceLatent",
      "FluxKVCache",
      "ModelAttentionBackend",
    ];
    const [models, encoders, vaes, loras, ...nodeInfo] = await Promise.all([
      this.comfy.modelFiles("diffusion_models"),
      this.comfy.modelFiles("text_encoders"),
      this.comfy.modelFiles("vae"),
      this.comfy.modelFiles("loras"),
      ...classNames.map((className) =>
        this.comfy.objectInfo(className).catch(() => null),
      ),
    ]);
    const editNodeChecks = Object.fromEntries(
      classNames.map((className, index) => [
        className,
        objectInfoContains(nodeInfo[index], className),
      ]),
    );
    const editCoreNodeChecks = Object.fromEntries(
      Object.entries(editNodeChecks).filter(([className]) =>
        className !== "FluxKVCache" && className !== "ModelAttentionBackend",
      ),
    );
    const kvCacheNodeAvailable = editNodeChecks.FluxKVCache === true;
    const attentionNodeAvailable = editNodeChecks.ModelAttentionBackend === true;
    const attentionBackendOptions = objectInfoOptions(
      nodeInfo[classNames.indexOf("ModelAttentionBackend")],
      "ModelAttentionBackend",
      "attention",
    );
    const generateChecks = {
      workflow: existsSync(this.generateWorkflowPath),
      model: models.includes(settings.krea.model),
      encoder: encoders.includes(settings.krea.encoder),
      vae: vaes.includes(settings.krea.vae),
      loras: settings.krea.loras.every((slot) => loras.includes(slot.name)),
    };
    const editChecks = {
      workflow: existsSync(this.editWorkflowPath),
      model: models.includes(settings.imageEdit.model),
      encoder: encoders.includes(settings.imageEdit.encoder),
      vae: vaes.includes(settings.imageEdit.vae),
      nodes: Object.values(editCoreNodeChecks).every(Boolean),
      kvCache:
        !settings.imageEdit.kvCacheEnabled || kvCacheNodeAvailable,
      attentionBackend:
        settings.imageEdit.attentionBackend === "auto" ||
        attentionBackendOptions.includes(settings.imageEdit.attentionBackend),
    };
    return {
      ready: Object.values(generateChecks).every(Boolean) &&
        Object.values(editChecks).every(Boolean),
      generate: {
        ready: Object.values(generateChecks).every(Boolean),
        checks: generateChecks,
        engine: settings.krea,
        workflow: this.generateWorkflowPath,
      },
      edit: {
        ready: Object.values(editChecks).every(Boolean),
        checks: {
          ...editChecks,
          nodeClasses: editCoreNodeChecks,
          kvCacheNodeAvailable,
          kvCacheEnabled: settings.imageEdit.kvCacheEnabled,
          attentionNodeAvailable,
          attentionBackendOptions,
          attentionBackend: settings.imageEdit.attentionBackend,
        },
        engine: settings.imageEdit,
        workflow: this.editWorkflowPath,
        referenceLimit: IMAGE_EDIT_MAX_REFERENCES,
      },
      capabilities: {
        models: [...new Set(models)].sort(),
        textEncoders: [...new Set(encoders)].sort(),
        vaes: [...new Set(vaes)].sort(),
        loras: [...new Set(loras)].sort(),
        uiTargetMaxPixels: IMAGE_UI_TARGET_MAX_PIXELS,
        apiMaxPixels: IMAGE_API_MAX_PIXELS,
        sizeMultiple: 16,
      },
      storage: this.repository.stats(),
    };
  }

  private present(job: NonNullable<ReturnType<ImageJobRepository["get"]>>) {
    return {
      ...job,
      candidates: job.candidates.map((candidate) => {
        const progress = candidate.promptId
          ? this.progressTracker?.get(candidate.promptId)
          : null;
        return {
          ...candidate,
          phase: progress?.phase ?? null,
          phaseLabel: progress?.phaseLabel ?? null,
          progress: progress?.progress ?? null,
          progressExact: progress?.exact ?? false,
        };
      }),
    };
  }
}
