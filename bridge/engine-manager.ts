import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

export type EngineMode = "embedded" | "external";

export type EngineManagerOptions = {
  mode: EngineMode;
  rootDir: string;
  dataDir: string;
  host: string;
  port: number;
  pythonPath?: string;
  comfyRoot?: string;
  startupTimeoutMs?: number;
};

export type EngineRuntime = {
  pythonPath: string;
  comfyRoot: string;
  mainPath: string;
};

export type EngineStatus = {
  mode: EngineMode;
  installed: boolean;
  running: boolean;
  owned: boolean;
  url: string;
  pid: number | null;
  rootDir: string;
  inputDir: string;
  outputDir: string;
  logPath: string;
  runtime: EngineRuntime | null;
  error: string | null;
};

function firstExisting(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function normalizeHost(host: string) {
  const value = host.trim();
  if (!value || value === "0.0.0.0" || value === "::") return "127.0.0.1";
  return value;
}

export class EngineManager {
  readonly mode: EngineMode;
  readonly rootDir: string;
  readonly inputDir: string;
  readonly outputDir: string;
  readonly logPath: string;
  readonly url: string;
  private readonly host: string;
  private readonly port: number;
  private readonly configuredPython?: string;
  private readonly configuredComfyRoot?: string;
  private readonly startupTimeoutMs: number;
  private process: ChildProcess | null = null;
  private lastError: string | null = null;

  constructor(options: EngineManagerOptions) {
    this.mode = options.mode;
    this.rootDir = path.resolve(options.rootDir);
    this.host = normalizeHost(options.host);
    this.port = options.port;
    this.configuredPython = options.pythonPath?.trim()
      ? path.resolve(options.pythonPath)
      : undefined;
    this.configuredComfyRoot = options.comfyRoot?.trim()
      ? path.resolve(options.comfyRoot)
      : undefined;
    this.startupTimeoutMs = Math.max(5_000, options.startupTimeoutMs ?? 180_000);
    this.inputDir = path.resolve(options.dataDir, "engine-input");
    this.outputDir = path.resolve(options.dataDir, "engine-output");
    this.logPath = path.resolve(options.dataDir, "engine.log");
    const displayHost = this.host.includes(":") ? `[${this.host}]` : this.host;
    this.url = `http://${displayHost}:${this.port}`;
  }

  resolveRuntime(): EngineRuntime | null {
    if (this.mode === "external") return null;
    const pythonPath = firstExisting([
      ...(this.configuredPython ? [this.configuredPython] : []),
      path.join(this.rootDir, "python", "python.exe"),
      path.join(this.rootDir, "python_embeded", "python.exe"),
      path.join(this.rootDir, ".venv", "Scripts", "python.exe"),
      path.join(this.rootDir, "python", "bin", "python3"),
      path.join(this.rootDir, ".venv", "bin", "python"),
    ]);
    const comfyRoot = firstExisting([
      ...(this.configuredComfyRoot ? [this.configuredComfyRoot] : []),
      path.join(this.rootDir, "ComfyUI"),
      this.rootDir,
    ].filter((candidate) => existsSync(path.join(candidate, "main.py"))));
    if (!pythonPath || !comfyRoot) return null;
    return { pythonPath, comfyRoot, mainPath: path.join(comfyRoot, "main.py") };
  }

  private ownsLiveProcess() {
    return this.process !== null && this.process.exitCode === null && !this.process.killed;
  }

  private async requestJson(endpoint: string, timeoutMs = 2_500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.url}${endpoint}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return await response.json() as Record<string, unknown>;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeSystem() {
    return (await this.requestJson("/system_stats")) !== null;
  }

  private async probe() {
    if (this.mode === "external") return this.probeSystem();
    const identity = await this.requestJson("/h3_studio/engine/identity");
    return identity?.product === "h3-studio" && identity.embedded === true;
  }

  async status(): Promise<EngineStatus> {
    const runtime = this.resolveRuntime();
    const running = await this.probe();
    const installed = this.mode === "external" ? true : runtime !== null;
    return {
      mode: this.mode,
      installed,
      running,
      owned: this.ownsLiveProcess(),
      url: this.url,
      pid: this.ownsLiveProcess() ? this.process?.pid ?? null : null,
      rootDir: this.rootDir,
      inputDir: this.inputDir,
      outputDir: this.outputDir,
      logPath: this.logPath,
      runtime,
      error: this.lastError ?? (
        installed
          ? running ? null : this.mode === "external" ? "Motore esterno non raggiungibile" : "Motore incorporato non avviato"
          : "Runtime incorporato non installato"
      ),
    };
  }

  async ensureRunning() {
    if (await this.probe()) {
      this.lastError = null;
      return this.status();
    }
    if (this.mode === "external") {
      this.lastError = "Motore esterno non raggiungibile";
      return this.status();
    }
    return this.start();
  }

  async start() {
    if (await this.probe()) return this.status();
    if (this.mode === "embedded" && await this.probeSystem()) {
      this.lastError = `La porta ${this.port} è occupata da un motore non gestito da H3 Studio`;
      return this.status();
    }
    const runtime = this.resolveRuntime();
    if (!runtime) {
      this.lastError = "Runtime incorporato non installato";
      return this.status();
    }
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    mkdirSync(this.inputDir, { recursive: true });
    mkdirSync(this.outputDir, { recursive: true });
    const logDescriptor = openSync(this.logPath, "a");
    const args = [
      "-s",
      runtime.mainPath,
      "--windows-standalone-build",
      "--listen", this.host,
      "--port", String(this.port),
      "--input-directory", this.inputDir,
      "--output-directory", this.outputDir,
      "--disable-smart-memory",
    ];
    try {
      this.process = spawn(runtime.pythonPath, args, {
        cwd: path.dirname(runtime.comfyRoot),
        env: {
          ...process.env,
          H3_STUDIO_EMBEDDED_ENGINE: "1",
          PYTHONNOUSERSITE: "1",
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
        stdio: ["ignore", logDescriptor, logDescriptor],
        windowsHide: true,
      });
    } finally {
      closeSync(logDescriptor);
    }
    this.process.once("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGTERM") {
        this.lastError = `Il motore incorporato si è chiuso (codice ${code ?? "?"})`;
      }
    });
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.ownsLiveProcess()) {
        this.lastError ??= "Il motore incorporato si è chiuso durante l'avvio";
        return this.status();
      }
      if (await this.probe()) {
        this.lastError = null;
        return this.status();
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    this.lastError = "Timeout durante l'avvio del motore incorporato";
    await this.stop();
    return this.status();
  }

  async stop() {
    const current = this.process;
    this.process = null;
    if (!current || current.exitCode !== null || current.killed) return this.status();
    current.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => current.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
    ]);
    // ChildProcess.killed only means that a signal was sent; it does not prove
    // that the process has exited. Force the shutdown after the grace period.
    if (current.exitCode === null) current.kill("SIGKILL");
    this.lastError = null;
    return this.status();
  }
}
