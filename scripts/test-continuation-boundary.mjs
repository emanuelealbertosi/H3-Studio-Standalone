import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const samplerPath = fileURLToPath(
  new URL(
    "../comfyui_nodes/ComfyUI-H3-Multishot/h3_reference_memory.py",
    import.meta.url,
  ),
);
const source = await readFile(samplerPath, "utf8");

assert.match(
  source,
  /None if operation_mode == "VIDEO EXTENSION" else initial_video/,
  "VIDEO EXTENSION must not condition on the full source video",
);
assert.match(
  source,
  /operation_mode == "VIDEO EXTENSION" and shot_index == 0/,
  "the external boundary must be promoted to encoder memory",
);
assert.match(
  source,
  /prompt\.replace\([\s\S]*"<Video 1>"[\s\S]*"the supplied previous-shot boundary"/,
  "the boundary-only prompt must not keep a dangling Video 1 marker",
);
assert.match(
  source,
  /trim_boundary[\s\S]*operation_mode == "VIDEO EXTENSION"[\s\S]*images = images\[1:\]/,
  "the duplicate boundary frame must be trimmed like internal multishot shots",
);

console.log("Video continuation boundary regression passed.");
