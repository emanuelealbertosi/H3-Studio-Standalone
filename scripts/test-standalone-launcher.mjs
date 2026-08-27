import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync("scripts/standalone-launcher.mjs", "utf8");
const batch = readFileSync("START_H3_STUDIO_STANDALONE.bat", "utf8");
assert.match(launcher, /api\/setup\/status/);
assert.match(launcher, /taskkill\.exe/);
assert.match(launcher, /Premi Ctrl\+C/);
assert.match(launcher, /H3_NO_BROWSER/);
assert.match(batch, /engine\\tools\\node\\node\.exe/);
assert.match(batch, /INSTALL_H3_STUDIO_STANDALONE\.bat/);
console.log("Standalone launcher contract: OK");
