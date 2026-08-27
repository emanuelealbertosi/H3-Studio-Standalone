import path from "node:path";

function readPort(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function readOrigins(value: string | undefined) {
  return (value ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const dataDir = path.resolve(
  process.env.H3_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
);
const engineMode = process.env.H3_ENGINE_MODE?.trim().toLowerCase() === "external"
  ? "external" as const
  : "embedded" as const;
const engineHost = process.env.H3_ENGINE_HOST?.trim() || "127.0.0.1";
const enginePort = readPort(process.env.H3_ENGINE_PORT, 9000);
const engineDisplayHost = engineHost === "0.0.0.0" || engineHost === "::"
  ? "127.0.0.1"
  : engineHost;
const engineUrl = `http://${engineDisplayHost.includes(":") ? `[${engineDisplayHost}]` : engineDisplayHost}:${enginePort}`;

export const config = Object.freeze({
  host: process.env.H3_BRIDGE_HOST?.trim() || "127.0.0.1",
  port: readPort(process.env.H3_BRIDGE_PORT, 8787),
  engine: Object.freeze({
    mode: engineMode,
    rootDir: path.resolve(
      process.env.H3_ENGINE_ROOT?.trim() || path.join(process.cwd(), "engine", "runtime"),
    ),
    host: engineHost,
    port: enginePort,
    pythonPath: process.env.H3_ENGINE_PYTHON?.trim() || undefined,
    comfyRoot: process.env.H3_ENGINE_COMFY_ROOT?.trim() || undefined,
    startupTimeoutMs: readPositiveInteger(process.env.H3_ENGINE_START_TIMEOUT_MS, 180_000),
  }),
  comfyUrl: normalizeBaseUrl(
    process.env.H3_COMFY_URL || engineUrl,
  ),
  comfyTimeoutMs: readPositiveInteger(
    process.env.H3_COMFY_TIMEOUT_MS,
    3000,
  ),
  comfyOutputDir: path.resolve(
    process.env.H3_COMFY_OUTPUT_DIR?.trim() ||
      (engineMode === "embedded"
        ? path.join(dataDir, "engine-output")
        : path.join(dataDir, "comfy-output-not-configured")),
  ),
  workflowSourcePath:
    process.env.H3_WORKFLOW_SOURCE?.trim() ||
    path.join(process.cwd(), "workflows", "studio-backend.ui.json"),
  kreaWorkflowSourcePath:
    process.env.H3_KREA_WORKFLOW_SOURCE?.trim() ||
    path.join(process.cwd(), "workflows", "studio-krea2.api.json"),
  workflowOutputDir: path.resolve(
    process.env.H3_WORKFLOW_OUTPUT_DIR?.trim() ||
      path.join(process.cwd(), "workflows"),
  ),
  dataDir,
  ffmpegPath:
    process.env.H3_FFMPEG_PATH?.trim() || "ffmpeg",
  webOrigins: readOrigins(process.env.H3_WEB_ORIGINS),
});
