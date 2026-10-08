import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bundle,
  formatProblems,
  getTotals,
  loadConfig,
  stringifyYaml,
} from "@redocly/openapi-core";

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

const json = JSON.stringify(result.parsed, null, 2);
await mkdir(outputDir, { recursive: true });
await writeFile(
  resolve(outputDir, "openapi.yaml"),
  stringifyYaml(result.parsed, { noRefs: true, lineWidth: -1 }),
);
await writeFile(resolve(outputDir, "openapi.json"), json);
await writeFile(resolve(outputDir, "openapi.mjs"), `export default ${json};\n`);
