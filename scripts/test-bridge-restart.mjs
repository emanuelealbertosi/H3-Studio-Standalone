import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "h3-restart-"));
const markerPath = path.join(temporaryDirectory, "restarted.txt");
const parent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
assert(parent.pid);

const replacementCode =
  `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ok')`;
const helper = spawn(
  process.execPath,
  [
    path.resolve("scripts", "restart-bridge-helper.mjs"),
    String(parent.pid),
    process.execPath,
    process.cwd(),
    JSON.stringify(["-e", replacementCode]),
  ],
  { stdio: "ignore" },
);

await new Promise((resolve) => setTimeout(resolve, 300));
parent.kill();

const deadline = Date.now() + 8_000;
while (!existsSync(markerPath) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

assert.equal(existsSync(markerPath), true, "Il processo sostitutivo non è partito");
helper.kill();
await rm(temporaryDirectory, { recursive: true, force: true });
console.log("Bridge restart helper: OK");
