import { spawn } from "node:child_process";

const [parentPidRaw, executable, workingDirectory, launchArgumentsJson] =
  process.argv.slice(2);
const parentPid = Number(parentPidRaw);
const launchArguments = JSON.parse(launchArgumentsJson);

if (!Number.isInteger(parentPid) || !executable || !workingDirectory || !Array.isArray(launchArguments)) {
  process.exit(2);
}

const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  try {
    process.kill(parentPid, 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    break;
  }
}

try {
  process.kill(parentPid, 0);
  process.exit(3);
} catch {
  const child = spawn(executable, launchArguments, {
    cwd: workingDirectory,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
