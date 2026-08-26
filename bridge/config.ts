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

export const config = Object.freeze({
  host: process.env.H3_BRIDGE_HOST?.trim() || "127.0.0.1",
  port: readPort(process.env.H3_BRIDGE_PORT, 8787),
  comfyUrl: normalizeBaseUrl(
    process.env.H3_COMFY_URL || "http://127.0.0.1:9000",
  ),
  comfyTimeoutMs: readPositiveInteger(
    process.env.H3_COMFY_TIMEOUT_MS,
    3000,
  ),
  comfyOutputDir: path.resolve(
    process.env.H3_COMFY_OUTPUT_DIR?.trim() ||
      path.join(process.cwd(), "data", "comfy-output-not-configured"),
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
  dataDir: path.resolve(
    process.env.H3_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
  ),
  ffmpegPath:
    process.env.H3_FFMPEG_PATH?.trim() || "ffmpeg",
  webOrigins: readOrigins(process.env.H3_WEB_ORIGINS),
});
import path from "node:path";
