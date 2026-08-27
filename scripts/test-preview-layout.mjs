import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [css, page] = await Promise.all([
  readFile("app/globals.css", "utf8"),
  readFile("app/page.tsx", "utf8"),
]);

assert.match(css, /\.candidate-footer\s*\{[^}]*flex-direction:\s*column/s);
assert.match(
  css,
  /\.postprocess-actions\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(76px,\s*1fr\)\)/s,
);
assert.match(css, /\.candidate-primary-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /\.postprocess-source\s*\{[^}]*min-width:\s*0/s);
assert.match(css, /\.candidate-variant-actions\s*\{[^}]*min-width:\s*0/s);
assert.match(css, /\.variant-switch\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(page, /className="candidate-primary-actions"/);
assert.match(page, /sourceVariantId:\s*activeVariant\.id/);
assert.match(page, /onClick=\{\(event\) => requestCandidateUpscale\(/);
assert.match(page, /onClick=\{confirmCandidateUpscale\}/);
const requestUpscaleBlock = page.match(
  /function requestCandidateUpscale\([\s\S]*?\n  }\n\n  function confirmCandidateUpscale/,
);
assert.ok(requestUpscaleBlock, "requestCandidateUpscale should be present");
assert.match(requestUpscaleBlock[0], /setPendingUpscaleRequest\(/);
assert.doesNotMatch(
  requestUpscaleBlock[0],
  /requireUpdatedPostprocessContract/,
  "the bridge guard must not prevent the confirmation modal from opening",
);
const runVariantBlock = page.match(
  /async function runCandidateVariant\([\s\S]*?\n  }\n\n  function applyCandidateDeletion/,
);
assert.ok(runVariantBlock, "runCandidateVariant should be present");
const guardIndex = runVariantBlock[0].indexOf(
  "requireUpdatedPostprocessContract()",
);
const postIndex = runVariantBlock[0].indexOf("await fetch(");
assert.ok(guardIndex >= 0, "the bridge guard should be present");
assert.ok(postIndex >= 0, "the post-process POST should be present");
assert.ok(
  guardIndex < postIndex,
  "the bridge guard must run before the post-process POST",
);
assert.match(page, /aria-modal="true"/);
assert.match(page, /role="dialog"/);
assert.match(page, /postprocessContract >= 2/);
assert.match(page, /Bridge non aggiornato: riavvia H3 Studio/);
assert.match(page, /className="upscale-confirm-bridge-alert"/);
assert.match(page, /role="alert"/);
assert.match(page, /disabled=\{postprocessContract < 2\}/);
assert.match(page, /Boolean\(control && !control\.disabled\)/);
assert.match(page, /function formatProcessingTime/);
assert.match(page, /function formatProcessingTimeLabel/);
assert.match(page, /return formatted \? `Tempo \${formatted}` : null/);
assert.match(page, /isReady \|\| isFailed\s*\? formatProcessingTime/s);
assert.match(page, /setCurrentJobMegapixels\(job\.request\.megapixels\)/);
assert.match(page, /candidateVersionMegapixels\(\s*currentJobMegapixels,/s);
assert.match(page, /const isFailed = candidate\.status === "failed"/);
assert.match(page, /\{!isFailed && \(\s*<div className=\{`progress-track/s);
assert.match(page, /\{\(isReady \|\| isFailed\) && \(\s*<button/s);
assert.match(page, /aria-label="Clip del progetto"/);
assert.match(page, /projectId: id/);
assert.match(page, /variantId: variant\?\.id \?\? null/);
assert.match(css, /\.montage-source-strip\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/s);
assert.match(css, /\.upscale-confirm-backdrop\s*\{[^}]*position:\s*fixed/s);
assert.match(css, /\.upscale-confirm-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 40px\)/s);
assert.match(css, /\.upscale-confirm-bridge-alert\s*\{[^}]*border:/s);
assert.match(css, /\.upscale-confirm-actions button:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
assert.match(css, /@media\s*\(max-width:\s*480px\)[^{]*\{[^}]*\.upscale-confirm-backdrop/s);

console.log("Preview card responsive layout: OK");
