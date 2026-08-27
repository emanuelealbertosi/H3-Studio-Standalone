import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeUrl = process.env.NEXT_PUBLIC_H3_BRIDGE_URL || "http://127.0.0.1:8787";
const webUrl = process.env.H3_STANDALONE_WEB_URL || "http://localhost:3000";
const mode = process.env.H3_STANDALONE_WEB_MODE === "production" ? "start" : "dev";
const children = new Set();
let shuttingDown = false;

async function reachable(url, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timeout durante l'avvio di ${label}: ${url}`);
}

function terminateTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) terminateTree(child);
  process.exit(exitCode);
}

function launch(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });
  children.add(child);
  child.once("exit", (code) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[H3 Studio] ${label} terminato con codice ${code ?? "?"}.`);
      shutdown(code === 0 ? 0 : 1);
    }
  });
  return child;
}

async function main() {
  const tsx = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const vinext = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
  if (!existsSync(tsx) || !existsSync(vinext)) {
    throw new Error("Dipendenze web mancanti. Esegui prima l'installer standalone.");
  }
  if (await reachable(`${bridgeUrl}/api/health`)) {
    throw new Error(`Un bridge è già attivo su ${bridgeUrl}. Chiudilo prima di avviare H3 Studio Standalone.`);
  }
  if (await reachable(webUrl)) {
    throw new Error(`La porta web è già occupata: ${webUrl}`);
  }

  console.log("[H3 Studio] Avvio bridge e motore incorporato...");
  launch("Bridge", ["--env-file-if-exists=.env", tsx, "bridge/server.ts"]);
  await waitFor(`${bridgeUrl}/api/setup/status`, 75_000, "bridge");

  console.log(`[H3 Studio] Avvio interfaccia (${mode})...`);
  launch("Web", [vinext, mode]);
  await waitFor(webUrl, 75_000, "interfaccia web");

  console.log("");
  console.log(`[H3 Studio] Pronto: ${webUrl}`);
  console.log("[H3 Studio] Premi Ctrl+C per chiudere applicazione e motore.");
  if (process.env.H3_NO_BROWSER !== "1" && process.platform === "win32") {
    const browser = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", webUrl], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    browser.unref();
  }
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.once("SIGHUP", () => shutdown(0));

main().catch((error) => {
  console.error(`[H3 Studio] ${error instanceof Error ? error.message : error}`);
  shutdown(1);
});
