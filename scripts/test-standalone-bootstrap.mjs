import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const fixtureRoot = path.join(
  projectRoot,
  "engine",
  "_test",
  `bootstrap-${process.pid}-${Date.now()}`,
);
const scriptPath = path.join(projectRoot, "scripts", "BOOTSTRAP_STANDALONE_ENGINE.ps1");
const runtimeRoot = path.join(fixtureRoot, "runtime");
const downloadRoot = path.join(fixtureRoot, "downloads");
const reportsToRemove = new Set();

function mkdir(relative) {
  const target = path.join(fixtureRoot, relative);
  mkdirSync(target, { recursive: true });
  return target;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function runPowerShell(args, expectedStatus = 0) {
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args,
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(
    result.status,
    expectedStatus,
    `Unexpected exit ${result.status}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  const match = result.stdout.match(/Report diagnostico:\s*(.+\.json)\s*$/m);
  if (match) {
    const reportPath = match[1].trim();
    reportsToRemove.add(reportPath);
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
      if (report.logPath) reportsToRemove.add(report.logPath);
      return { result, report };
    } catch {
      // A failure to parse is asserted explicitly by callers that need a report.
    }
  }
  return { result, report: null };
}

function createArchive(version, { includeModel = false } = {}) {
  const source = path.join(fixtureRoot, `source-${version}`);
  rmSync(source, { recursive: true, force: true });
  mkdirSync(path.join(source, "python_embeded"), { recursive: true });
  mkdirSync(path.join(source, "ComfyUI"), { recursive: true });
  writeFileSync(path.join(source, "python_embeded", "python.exe"), "fixture-python");
  writeFileSync(path.join(source, "ComfyUI", "main.py"), "# fixture");
  writeFileSync(
    path.join(source, "ComfyUI", "extra_model_paths.yaml"),
    "packaged_models:\n  base_path: ./models\n",
  );
  writeFileSync(path.join(source, "THIRD_PARTY_NOTICES.txt"), "Fixture notices");
  writeFileSync(path.join(source, "version.txt"), version);
  if (includeModel) {
    mkdirSync(path.join(source, "ComfyUI", "models"), { recursive: true });
    writeFileSync(path.join(source, "ComfyUI", "models", "forbidden.safetensors"), "no");
  }
  const archiveDir = mkdir("artifacts");
  const archive = path.join(archiveDir, `runtime-${version}.zip`);
  rmSync(archive, { force: true });
  const compress = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "Compress-Archive -Path (Join-Path $env:H3_TEST_SOURCE '*') -DestinationPath $env:H3_TEST_ARCHIVE -Force",
  ], {
    encoding: "utf8",
    env: { ...process.env, H3_TEST_SOURCE: source, H3_TEST_ARCHIVE: archive },
  });
  assert.equal(compress.status, 0, compress.stderr || compress.stdout);
  return { archive, hash: sha256(archive), size: statSync(archive).size };
}

function writeManifest(name, artifact, overrides = {}) {
  const manifest = {
    schemaVersion: 1,
    manifestVersion: name,
    releaseState: "published",
    engineVersion: name,
    distribution: "test-windows-x64",
    runtimeRoot: "unused-by-test",
    installedSizeBytes: 1,
    minimumFreeBytesAfterInstall: 0,
    platform: {
      os: "windows",
      architecture: "x64",
      minimumWindowsBuild: 0,
      gpuVendor: "any",
    },
    entrypoints: {
      python: "python_embeded/python.exe",
      comfy: "ComfyUI/main.py",
    },
    requiredFiles: [
      "python_embeded/python.exe",
      "ComfyUI/main.py",
      "ComfyUI/extra_model_paths.yaml",
      "THIRD_PARTY_NOTICES.txt",
    ],
    excludedArchivePrefixes: [
      "ComfyUI/models/",
      "ComfyUI/input/",
      "ComfyUI/output/",
    ],
    artifacts: [{
      id: "fixture-runtime",
      fileName: path.basename(artifact.archive),
      urls: [artifact.archive],
      sha256: artifact.hash,
      sizeBytes: artifact.size,
      archiveType: "zip",
    }],
    components: [],
    ...overrides,
  };
  const manifestPath = path.join(fixtureRoot, `manifest-${name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

try {
  const v1 = createArchive("v1");
  const unpublishedManifest = writeManifest("unpublished", v1, {
    releaseState: "unpublished",
    publication: { blockedReason: "Fixture intentionally unpublished." },
  });
  const unpublished = runPowerShell([
    "-ManifestPath", unpublishedManifest,
    "-DestinationRoot", path.join(fixtureRoot, "unpublished-runtime"),
  ], 1);
  assert.match(unpublished.report?.error ?? "", /Release engine non pubblicata/);

  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(path.join(runtimeRoot, "ComfyUI"), { recursive: true });
  writeFileSync(path.join(runtimeRoot, "version.txt"), "old");
  const privateModelPaths = "shared_models:\n  base_path: F:/shared-models\n";
  writeFileSync(path.join(runtimeRoot, "ComfyUI", "extra_model_paths.yaml"), privateModelPaths);

  const v1Manifest = writeManifest("v1", v1);
  mkdirSync(downloadRoot, { recursive: true });
  const partialPath = path.join(downloadRoot, path.basename(v1.archive) + ".partial");
  const archiveBytes = readFileSync(v1.archive);
  writeFileSync(partialPath, archiveBytes.subarray(0, Math.floor(archiveBytes.length / 2)));

  const installed = runPowerShell([
    "-ManifestPath", v1Manifest,
    "-DestinationRoot", runtimeRoot,
    "-DownloadRoot", downloadRoot,
    "-Force",
  ]);
  assert.equal(installed.report?.status, "installed");
  assert.equal(readFileSync(path.join(runtimeRoot, "version.txt"), "utf8"), "v1");
  assert.equal(
    readFileSync(path.join(runtimeRoot, "ComfyUI", "extra_model_paths.yaml"), "utf8"),
    privateModelPaths,
  );
  assert.ok(existsSync(path.join(runtimeRoot, ".installed-manifest.json")));
  assert.equal(sha256(path.join(downloadRoot, path.basename(v1.archive))), v1.hash);

  const freshRuntime = path.join(fixtureRoot, "fresh-runtime");
  const fresh = runPowerShell([
    "-ManifestPath", v1Manifest,
    "-DestinationRoot", freshRuntime,
    "-DownloadRoot", path.join(fixtureRoot, "fresh-downloads"),
  ]);
  assert.equal(fresh.report?.status, "installed");
  const generatedModelPaths = readFileSync(
    path.join(freshRuntime, "ComfyUI", "extra_model_paths.yaml"),
    "utf8",
  );
  assert.match(generatedModelPaths, /h3_studio_models:/);
  assert.ok(generatedModelPaths.includes(path.join(projectRoot, "models").replaceAll("\\", "/")));

  const badManifest = writeManifest("bad-hash", v1, {
    artifacts: [{
      id: "bad-hash",
      fileName: "bad-hash.zip",
      urls: [v1.archive],
      sha256: "0".repeat(64),
      sizeBytes: v1.size,
      archiveType: "zip",
    }],
  });
  const checksumFailure = runPowerShell([
    "-ManifestPath", badManifest,
    "-DestinationRoot", runtimeRoot,
    "-DownloadRoot", path.join(fixtureRoot, "bad-download"),
    "-RetryCount", "1",
    "-Force",
  ], 1);
  assert.match(checksumFailure.report?.error ?? "", /Checksum SHA-256 errato/);
  assert.equal(readFileSync(path.join(runtimeRoot, "version.txt"), "utf8"), "v1");

  const forbidden = createArchive("forbidden", { includeModel: true });
  const forbiddenManifest = writeManifest("forbidden", forbidden);
  const modelFailure = runPowerShell([
    "-ManifestPath", forbiddenManifest,
    "-DestinationRoot", runtimeRoot,
    "-Force",
  ], 1);
  assert.match(modelFailure.report?.error ?? "", /dati vietati dalla policy/);
  assert.equal(readFileSync(path.join(runtimeRoot, "version.txt"), "utf8"), "v1");

  const v2 = createArchive("v2");
  const v2Manifest = writeManifest("v2", v2);
  const upgraded = runPowerShell([
    "-ManifestPath", v2Manifest,
    "-DestinationRoot", runtimeRoot,
    "-Force",
  ]);
  assert.equal(upgraded.report?.status, "installed");
  assert.equal(readFileSync(path.join(runtimeRoot, "version.txt"), "utf8"), "v2");

  const invalidBackup = path.join(fixtureRoot, "_backups", "runtime-invalid");
  mkdirSync(invalidBackup, { recursive: true });
  writeFileSync(path.join(invalidBackup, "incomplete.txt"), "fixture");

  const rolledBack = runPowerShell([
    "-RollbackLatest",
    "-RollbackDestinationRoot", runtimeRoot,
  ]);
  assert.equal(rolledBack.report?.status, "rolled-back");
  assert.equal(readFileSync(path.join(runtimeRoot, "version.txt"), "utf8"), "v1");

  console.log("Standalone public bootstrap: OK");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  for (const report of reportsToRemove) rmSync(report, { force: true });
}
