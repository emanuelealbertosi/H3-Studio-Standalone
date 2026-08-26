import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [css, page] = await Promise.all([
  readFile("app/globals.css", "utf8"),
  readFile("app/page.tsx", "utf8"),
]);

assert.match(css, /\.candidate-footer\s*\{[^}]*flex-direction:\s*column/s);
assert.match(
  css,
  /\.postprocess-actions,\s*\.candidate-primary-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
);
assert.match(css, /\.candidate-variant-actions\s*\{[^}]*min-width:\s*0/s);
assert.match(css, /\.variant-switch\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(page, /className="candidate-primary-actions"/);

console.log("Preview card responsive layout: OK");
