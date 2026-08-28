import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const fixtureRoot = path.join(
  projectRoot,
  "engine",
  "_test",
  `artifact-builder-${process.pid}-${Date.now()}`,
);
const sourceRoot = path.join(fixtureRoot, "runtime");
const workspaceNode = path.join(fixtureRoot, "workspace-node");
const builder = path.join(projectRoot, "scripts", "build-standalone-engine-artifact.py");
const python = process.env.H3_TEST_PYTHON
  || path.join(projectRoot, "engine", "runtime", "python_embeded", "python.exe");

function write(relative, value) {
  const target = path.join(fixtureRoot, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
  return target;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function runBuilder(args, expectedStatus = 0) {
  const result = spawnSync(python, [builder, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    expectedStatus,
    `Unexpected builder exit ${result.status}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
}

function zipEntries(archive) {
  const code = [
    "import json,sys,zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    " print(json.dumps(z.namelist()))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code, archive], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  write("runtime/python_embeded/python.exe", "python");
  write("runtime/python_embeded/LICENSE.txt", "PSF fixture");
  write("runtime/ComfyUI/main.py", "# comfy fixture");
  write("runtime/ComfyUI/LICENSE", "GPL fixture");
  write("runtime/ComfyUI/models/forbidden.safetensors", "model");
  write("runtime/ComfyUI/user/private.sqlite", "private");
  write("runtime/ComfyUI/extra_model_paths.yaml", "machine-specific");
  write("runtime/ComfyUI/custom_nodes/example-node/__init__.py", "runtime-copy");
  write("runtime/ComfyUI/custom_nodes/example-node/LICENSE", "MIT fixture");
  write("workspace-node/__init__.py", "workspace-copy");
  write("workspace-node/LICENSE", "MIT fixture");
  write(
    "runtime/python_embeded/Lib/site-packages/demo-1.0.dist-info/METADATA",
    "Metadata-Version: 2.4\nName: demo\nVersion: 1.0\nLicense-Expression: MIT\n",
  );
  write(
    "runtime/python_embeded/Lib/site-packages/mystery-2.0.dist-info/METADATA",
    "Metadata-Version: 2.4\nName: mystery\nVersion: 2.0\n",
  );
  write(
    "runtime/python_embeded/Lib/site-packages/mystery-2.0.dist-info/COPYRIGHT.txt",
    "ISC fixture evidence",
  );

  const baseManifest = {
    schemaVersion: 1,
    manifestVersion: "fixture",
    releaseState: "unpublished",
    engineVersion: "fixture",
    distribution: "windows-nvidia-x64",
    runtimeRoot: "engine/runtime",
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
    requiredFiles: [],
    excludedArchivePrefixes: [
      "ComfyUI/models/",
      "ComfyUI/input/",
      "ComfyUI/output/",
      "ComfyUI/temp/",
      "ComfyUI/user/",
    ],
    artifacts: [],
    publication: { blockedReason: "fixture" },
    components: [],
  };
  const manifestPath = write("base-manifest.json", JSON.stringify(baseManifest, null, 2));
  const workspaceRelative = path.relative(projectRoot, workspaceNode).replaceAll("\\", "/");
  const componentLock = {
    schemaVersion: 1,
    components: [
      {
        id: "python",
        runtimePath: "python_embeded",
        source: "https://www.python.org/",
        version: "fixture",
        license: "PSF-2.0",
        licenseStatus: "verified",
        licensePath: "python_embeded/LICENSE.txt",
      },
      {
        id: "comfy",
        runtimePath: "ComfyUI",
        source: "https://github.com/Comfy-Org/ComfyUI",
        version: "fixture",
        license: "GPL-3.0-only",
        licenseStatus: "verified",
        licensePath: "ComfyUI/LICENSE",
      },
      {
        id: "example",
        runtimePath: "ComfyUI/custom_nodes/example-node",
        source: `workspace:${workspaceRelative}`,
        version: "workspace",
        license: "MIT",
        licenseStatus: "verified",
        licensePath: "ComfyUI/custom_nodes/example-node/LICENSE",
      },
    ],
  };
  const lockPath = write("components.lock.json", JSON.stringify(componentLock, null, 2));
  const pythonLicenseLockPath = write("python-license.lock.json", JSON.stringify({
    schemaVersion: 1,
    packages: [
      {
        name: "mystery",
        version: "2.0",
        license: "ISC",
        evidencePath: "python_embeded/Lib/site-packages/mystery-2.0.dist-info/COPYRIGHT.txt",
        source: "https://example.invalid/mystery",
        licenseUrl: "https://example.invalid/mystery/license",
        note: "Fixture override",
      },
    ],
  }, null, 2));

  const outputs = [path.join(fixtureRoot, "out-a"), path.join(fixtureRoot, "out-b")];
  for (const output of outputs) {
    runBuilder([
      "--source-root", sourceRoot,
      "--output-directory", output,
      "--base-manifest", manifestPath,
      "--components-lock", lockPath,
      "--python-license-lock", pythonLicenseLockPath,
      "--engine-version", "fixture-1",
      "--compression", "stored",
      "--source-date-epoch", "1787875200",
    ]);
  }

  const archiveName = "h3-engine-fixture-1-windows-nvidia-x64.zip";
  const archiveA = path.join(outputs[0], archiveName);
  const archiveB = path.join(outputs[1], archiveName);
  assert.equal(sha256(archiveA), sha256(archiveB), "Artifact build is not deterministic");

  const entries = zipEntries(archiveA);
  assert.ok(entries.includes("THIRD_PARTY_NOTICES.txt"));
  assert.ok(entries.includes("component-inventory.json"));
  assert.ok(entries.includes("python-packages.sbom.json"));
  assert.ok(entries.includes("LICENSES/H3-Studio/LICENSE"));
  assert.ok(!entries.some((entry) => entry.startsWith("ComfyUI/models/")));
  assert.ok(!entries.some((entry) => entry.startsWith("ComfyUI/user/")));
  assert.ok(!entries.includes("ComfyUI/extra_model_paths.yaml"));

  const inspectCode = [
    "import sys,zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    " print(z.read('ComfyUI/custom_nodes/example-node/__init__.py').decode())",
  ].join("\n");
  const overlay = spawnSync(python, ["-c", inspectCode, archiveA], { encoding: "utf8" });
  assert.equal(overlay.status, 0, overlay.stderr);
  assert.equal(overlay.stdout.trim(), "workspace-copy");

  const manifest = JSON.parse(readFileSync(path.join(outputs[0], "manifest.json"), "utf8"));
  assert.equal(manifest.releaseState, "unpublished");
  assert.equal(manifest.artifacts[0].sha256, sha256(archiveA));
  assert.equal(manifest.publication.unresolvedLicenseCount, 0);
  const sbomCode = [
    "import json,sys,zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    " print(z.read('python-packages.sbom.json').decode())",
  ].join("\n");
  const sbomResult = spawnSync(python, ["-c", sbomCode, archiveA], { encoding: "utf8" });
  assert.equal(sbomResult.status, 0, sbomResult.stderr);
  const sbom = JSON.parse(sbomResult.stdout);
  const mystery = sbom.packages.find((item) => item.name === "mystery");
  assert.equal(mystery.license, "ISC");
  assert.equal(mystery.licenseEvidence, "python_embeded/Lib/site-packages/mystery-2.0.dist-info/COPYRIGHT.txt");

  const unresolvedLock = structuredClone(componentLock);
  unresolvedLock.components[2].license = "NOASSERTION";
  unresolvedLock.components[2].licenseStatus = "unresolved";
  unresolvedLock.components[2].licensePath = null;
  const unresolvedPath = write("components-unresolved.lock.json", JSON.stringify(unresolvedLock));
  const rejected = runBuilder([
    "--source-root", sourceRoot,
    "--output-directory", path.join(fixtureRoot, "rejected"),
    "--base-manifest", manifestPath,
    "--components-lock", unresolvedPath,
    "--python-license-lock", pythonLicenseLockPath,
    "--release",
    "--artifact-url", "https://example.invalid/releases/fixture.zip",
    "--allow-incomplete-notices",
    "--validate-only",
  ], 1);
  assert.match(rejected.stderr, /License metadata incomplete/);

  console.log("Standalone artifact builder: OK");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
