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
assert.match(page, /targetMegapixels:\s*target/);
assert.match(page, /setCurrentJobMegapixels\(job\.request\.megapixels\)/);
assert.match(page, /candidateVersionMegapixels\(\s*currentJobMegapixels,/s);
assert.match(page, /const isFailed = candidate\.status === "failed"/);
assert.match(page, /\{!isFailed && \(\s*<div className=\{`progress-track/s);
assert.match(page, /\{\(isReady \|\| isFailed\) && \(\s*<button/s);
assert.match(page, /aria-label="Clip del progetto"/);
assert.match(page, /projectId: id/);
assert.match(page, /variantId: variant\?\.id \?\? null/);
assert.match(css, /\.montage-source-strip\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/s);

console.log("Preview card responsive layout: OK");
