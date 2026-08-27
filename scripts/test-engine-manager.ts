import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineManager } from "../bridge/engine-manager.js";

const temp = mkdtempSync(path.join(os.tmpdir(), "h3-engine-test-"));
try {
  const runtimeRoot = path.join(temp, "engine", "runtime");
  const python = path.join(runtimeRoot, "python_embeded", "python.exe");
  const comfyRoot = path.join(runtimeRoot, "ComfyUI");
  mkdirSync(path.dirname(python), { recursive: true });
  mkdirSync(comfyRoot, { recursive: true });
  writeFileSync(python, "test");
  writeFileSync(path.join(comfyRoot, "main.py"), "# test");

  const manager = new EngineManager({
    mode: "embedded",
    rootDir: runtimeRoot,
    dataDir: path.join(temp, "data"),
    host: "127.0.0.1",
    port: 18999,
  });
  assert.deepEqual(manager.resolveRuntime(), {
    pythonPath: python,
    comfyRoot,
    mainPath: path.join(comfyRoot, "main.py"),
  });
  const status = await manager.status();
  assert.equal(status.installed, true);
  assert.equal(status.running, false);
  assert.equal(status.owned, false);
  assert.equal(status.url, "http://127.0.0.1:18999");

  const missing = new EngineManager({
    mode: "embedded",
    rootDir: path.join(temp, "missing"),
    dataDir: path.join(temp, "data-missing"),
    host: "0.0.0.0",
    port: 19000,
  });
  const missingStatus = await missing.status();
  assert.equal(missingStatus.installed, false);
  assert.equal(missingStatus.url, "http://127.0.0.1:19000");
  const serverSource = readFileSync(path.resolve("bridge", "server.ts"), "utf8");
  const configSource = readFileSync(path.resolve("bridge", "config.ts"), "utf8");
  assert.match(serverSource, /new EngineManager/);
  assert.match(serverSource, /\/api\/admin\/engine\/start/);
  assert.match(serverSource, /await engineManager\.stop\(\)/);
  assert.match(configSource, /"embedded" as const/);
  const nodeSource = readFileSync(
    path.resolve("comfyui_nodes", "H3-Studio-Gemma4-Chat", "h3_studio_chat.py"),
    "utf8",
  );
  assert.match(nodeSource, /\/h3_studio\/engine\/identity/);
  assert.match(nodeSource, /H3_STUDIO_EMBEDDED_ENGINE/);
  console.log("Embedded engine manager: OK");
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
