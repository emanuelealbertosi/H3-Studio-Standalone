import assert from "node:assert/strict";
import path from "node:path";
import { EngineManager } from "../bridge/engine-manager";

function readPort(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

const runtimeRoot = path.resolve(
  process.env.H3_VERIFY_RUNTIME_ROOT
    || path.join(process.cwd(), "engine", "_test", "verified-runtime"),
);
const dataDir = path.resolve(
  process.env.H3_VERIFY_DATA_DIR
    || path.join(process.cwd(), "engine", "_test", "verified-runtime-data"),
);
const port = readPort(process.env.H3_VERIFY_PORT, 19000);
const manager = new EngineManager({
  mode: "embedded",
  rootDir: runtimeRoot,
  dataDir,
  host: "127.0.0.1",
  port,
  startupTimeoutMs: 240_000,
});

async function main() {
  const before = await manager.status();
  assert.equal(before.installed, true, `Runtime non installato: ${runtimeRoot}`);
  assert.equal(before.running, false, `Porta di verifica già occupata: ${port}`);

  try {
    const started = await manager.start();
    assert.equal(started.installed, true);
    assert.equal(started.running, true, started.error ?? "Engine non raggiungibile");
    assert.equal(started.owned, true, "Engine avviato ma non posseduto");
    assert.ok(started.pid && started.pid > 0, "PID engine mancante");

    const identity = await fetch(
      `http://127.0.0.1:${port}/h3_studio/engine/identity`,
      { cache: "no-store" },
    ).then((response) => response.json()) as {
      product?: string;
      embedded?: boolean;
    };
    assert.equal(identity.product, "h3-studio");
    assert.equal(identity.embedded, true);
  } finally {
    await manager.stop();
  }

  const stopped = await manager.status();
  assert.equal(stopped.running, false, "Engine ancora raggiungibile dopo stop");
  assert.equal(stopped.owned, false, "Ownership engine non rilasciata");
  console.log(`Standalone runtime start/health/stop: OK (port ${port})`);
}

await main();
