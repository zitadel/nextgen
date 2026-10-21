import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The CLI's commands as data, which the CLI's reference test writes from its
// command table (apps/cli/tests/unit/lib/oclif/reference.test.ts).
const input = createRequire(import.meta.url).resolve("@zitadel/cli/command-reference.json");
const outputDir = resolve(docsRoot, ".generated");

const { $comment: _marker, ...reference } = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(reference.commands) || !Array.isArray(reference.globalFlags)) {
  throw new Error(`${input} lists no commands and no global flags`);
}

// lib/cli-reference.ts imports the reference as a module, as lib/openapi.ts
// does the API (scripts/bundle-openapi.mjs), and the declaration types it.
await mkdir(outputDir, { recursive: true });
await writeFile(
  resolve(outputDir, "cli.mjs"),
  `export default ${JSON.stringify(reference, null, 2)};\n`,
);
await writeFile(
  resolve(outputDir, "cli.d.mts"),
  [
    'import type { CliReference } from "../lib/cli-reference.ts";',
    "",
    "declare const reference: CliReference;",
    "export default reference;",
    "",
  ].join("\n"),
);
