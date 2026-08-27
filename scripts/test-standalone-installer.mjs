import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixture = mkdtempSync(path.join(tmpdir(), "h3-engine-installer-"));
const requiredNodes = [
  "ComfyUI-Fantastic-MiniMaxH3-PromptBuilder",
  "ComfyUI-DaSiWa-Nodes",
  "rgthree-comfy",
  "ComfyUI-KJNodes",
  "ComfyUI-VideoHelperSuite",
  "ComfyUI-MiniMax-H3-PDD-Acc",
  "ComfyUI-Conditioning-Rebalance",
  "ComfyUI-H3-FaceRefine",
  "ComfyUI-H3-NativeAudioLock",
  "Comfyui_Minimax_h3_latent_Upscaler",
];

try {
  mkdirSync(path.join(fixture, "python_embeded"), { recursive: true });
  mkdirSync(path.join(fixture, "ComfyUI", "custom_nodes"), { recursive: true });
  writeFileSync(path.join(fixture, "python_embeded", "python.exe"), "fixture");
  writeFileSync(path.join(fixture, "ComfyUI", "main.py"), "# fixture");
  for (const node of requiredNodes) {
    mkdirSync(path.join(fixture, "ComfyUI", "custom_nodes", node), { recursive: true });
  }
  const result = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.resolve("scripts/INSTALL_STANDALONE_ENGINE.ps1"),
    "-SourcePortableRoot", fixture,
    "-ValidateOnly",
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  if (parsed.nodesFound.length !== requiredNodes.length) {
    throw new Error(`Expected ${requiredNodes.length} nodes, got ${parsed.nodesFound.length}`);
  }
  if (parsed.nodesMissing.length !== 0) throw new Error("Unexpected missing nodes");
  console.log("standalone installer validation: ok");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
