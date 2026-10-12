import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, formatProblems, getTotals, loadConfig } from "@redocly/openapi-core";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(docsRoot, "../..");
const input = resolve(repoRoot, "api/openapi/openapi-spec.yaml");
const outputDir = resolve(docsRoot, ".generated");

// Bundles with the library the Redocly CLI is built on, and the repo's
// redocly.yaml, the same way `redocly bundle` does.
const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
const { bundle: result, problems } = await bundle({ ref: input, config });
const totals = getTotals(problems);
if (totals.errors > 0) {
  formatProblems(problems, { format: "codeframe", totals });
  throw new Error(`bundling ${input} failed with ${totals.errors} error(s)`);
}

// lib/openapi.ts imports the bundle as a module, so it ships inside the
// build instead of being read from a build-machine path at runtime. The
// declaration types it as the OpenAPI document it is, instead of the literal
// type TypeScript would infer from the data.
await mkdir(outputDir, { recursive: true });
await writeFile(
  resolve(outputDir, "openapi.mjs"),
  `export default ${JSON.stringify(result.parsed, null, 2)};\n`,
);
await writeFile(
  resolve(outputDir, "openapi.d.mts"),
  [
    'import type { OpenAPIV3_1 } from "fumadocs-openapi";',
    "",
    "declare const document: OpenAPIV3_1.Document;",
    "export default document;",
    "",
  ].join("\n"),
);
