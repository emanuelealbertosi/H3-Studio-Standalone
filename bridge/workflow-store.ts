import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComfyApiPrompt,
  ComfyClient,
  ComfyHistoryEntry,
} from "./comfy-client.js";

const REQUIRED_CLASSES = [
  "H3ModelLoaderAny",
  "H3ReferenceMemorySampler",
  "H3SaveContinuation",
  "H3AIOAutopromptRequest",
  "H3AIOPlanParser",
  "H3AIOGenerationRouter",
] as const;

type CaptureMetadata = {
  capturedAt: string;
  promptId: string;
  queueNumber: number | null;
  sourceWorkflow: string;
  uiSha256: string;
  apiSha256: string;
  apiNodeCount: number;
  requiredClasses: readonly string[];
};

export type WorkflowStatus = {
  ready: boolean;
  uiCopyReady: boolean;
  apiPromptReady: boolean;
  sourceWorkflow: string;
  uiCopyPath: string;
  apiPromptPath: string;
  capturedAt: string | null;
  promptId: string | null;
  apiNodeCount: number | null;
  missingClasses: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiPrompt(value: unknown): value is ComfyApiPrompt {
  if (!isRecord(value)) return false;
  const nodes = Object.values(value);
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.class_type === "string" &&
        isRecord(node.inputs),
    )
  );
}

function promptFromEntry(entry: ComfyHistoryEntry): ComfyApiPrompt | null {
  const candidate = Array.isArray(entry.prompt) ? entry.prompt[2] : null;
  return isApiPrompt(candidate) ? candidate : null;
}

function queueNumber(entry: ComfyHistoryEntry): number | null {
  if (!Array.isArray(entry.prompt)) return null;
  const value = entry.prompt[0];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
  return content;
}

export class WorkflowStore {
  private readonly uiCopyPath: string;
  private readonly apiPromptPath: string;
  private readonly metadataPath: string;

  constructor(
    private readonly sourceWorkflowPath: string,
    private readonly outputDir: string,
  ) {
    this.uiCopyPath = path.join(outputDir, "studio-backend.ui.json");
    this.apiPromptPath = path.join(outputDir, "studio-backend.api.json");
    this.metadataPath = path.join(outputDir, "studio-backend.meta.json");
  }

  private async readMetadata(): Promise<CaptureMetadata | null> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.metadataPath, "utf8"),
      );
      if (!isRecord(parsed) || typeof parsed.promptId !== "string") {
        return null;
      }
      return parsed as CaptureMetadata;
    } catch {
      return null;
    }
  }

  async importUiCopy() {
    await mkdir(this.outputDir, { recursive: true });
    const sourceContent = await readFile(this.sourceWorkflowPath, "utf8");
    const parsed: unknown = JSON.parse(sourceContent);
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.links)
    ) {
      throw new Error("Il workflow sorgente non è un workflow UI ComfyUI valido");
    }
    await writeJsonAtomic(this.uiCopyPath, parsed);
    return { sha256: sha256(sourceContent), nodeCount: parsed.nodes.length };
  }

  async status(): Promise<WorkflowStatus> {
    const [uiCopyReady, apiPromptReady, metadata] = await Promise.all([
      exists(this.uiCopyPath),
      exists(this.apiPromptPath),
      this.readMetadata(),
    ]);

    return {
      ready: uiCopyReady && apiPromptReady && metadata !== null,
      uiCopyReady,
      apiPromptReady,
      sourceWorkflow: this.sourceWorkflowPath,
      uiCopyPath: this.uiCopyPath,
      apiPromptPath: this.apiPromptPath,
      capturedAt: metadata?.capturedAt ?? null,
      promptId: metadata?.promptId ?? null,
      apiNodeCount: metadata?.apiNodeCount ?? null,
      missingClasses: metadata ? [] : REQUIRED_CLASSES,
    };
  }

  async loadApiPrompt(): Promise<ComfyApiPrompt> {
    const parsed: unknown = JSON.parse(
      await readFile(this.apiPromptPath, "utf8"),
    );
    if (!isApiPrompt(parsed)) {
      throw new Error(
        "Workflow API Studio Backend assente o non valido: eseguire prima la cattura",
      );
    }
    return parsed;
  }

  async captureLatest(comfy: ComfyClient) {
    const ui = await this.importUiCopy();
    const history = await comfy.history(100);
    const candidates = Object.entries(history)
      .map(([promptId, entry]) => ({
        promptId,
        entry,
        prompt: promptFromEntry(entry),
        queueNumber: queueNumber(entry),
      }))
      .filter(
        (candidate): candidate is typeof candidate & { prompt: ComfyApiPrompt } =>
          candidate.prompt !== null,
      )
      .sort(
        (left, right) =>
          (right.queueNumber ?? Number.NEGATIVE_INFINITY) -
          (left.queueNumber ?? Number.NEGATIVE_INFINITY),
      );

    const match = candidates.find(({ prompt }) => {
      const classes = new Set(
        Object.values(prompt).map((node) => node.class_type),
      );
      return REQUIRED_CLASSES.every((classType) => classes.has(classType));
    });

    if (!match) {
      return {
        captured: false as const,
        message:
          "Copia UI creata. Esegui una volta il workflow FINAL in ComfyUI, poi ripeti la cattura.",
        status: await this.status(),
      };
    }

    const apiContent = await writeJsonAtomic(this.apiPromptPath, match.prompt);
    const metadata: CaptureMetadata = {
      capturedAt: new Date().toISOString(),
      promptId: match.promptId,
      queueNumber: match.queueNumber,
      sourceWorkflow: this.sourceWorkflowPath,
      uiSha256: ui.sha256,
      apiSha256: sha256(apiContent),
      apiNodeCount: Object.keys(match.prompt).length,
      requiredClasses: REQUIRED_CLASSES,
    };
    await writeJsonAtomic(this.metadataPath, metadata);

    return {
      captured: true as const,
      message: "Workflow Studio Backend catturato e validato.",
      status: await this.status(),
    };
  }
}
