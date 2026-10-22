import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, formatProblems, getTotals, loadConfig, parseYaml } from "@redocly/openapi-core";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(docsRoot, "../..");
const specRoot = resolve(repoRoot, "apps/api/api/openapi");
const input = resolve(specRoot, "openapi-spec.yaml");
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

// The API's error codes, for the reference's Errors page (lib/error-reference.ts):
// a schema per code the server defines, and each operation's error set, the
// codes its implementation can return. The server's code generates both
// (api/openapi/AGENTS.md). They are read from their files rather than from
// the bundle, which holds only the codes some operation references: an
// operation's set counts even where its `default` response does not reference
// it.
const schemasDir = join(specRoot, "components/schemas/errors");
const codeBySchema = new Map();
for (const name of (await readdir(schemasDir)).filter((file) => file.endsWith(".yaml")).sort()) {
  const schema = parseYaml(await readFile(join(schemasDir, name), "utf8"));
  const code = schema.allOf?.find((part) => part.properties?.code)?.properties.code.const;
  // The description, before the line that repeats the code.
  const description = String(schema.description ?? "")
    .replace(/\s*Error code:[^\n]*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (typeof code !== "string" || description === "") {
    throw new Error(`${join(schemasDir, name)} names no error code or no description`);
  }
  codeBySchema.set(name, { code, description });
}

const errorSetSuffix = "-error-response.yaml";
const errorSets = {};
const endpoints = (await readdir(join(specRoot, "endpoints"), { recursive: true }))
  .filter((file) => file.endsWith(errorSetSuffix))
  .sort();
for (const file of endpoints) {
  const response = parseYaml(await readFile(join(specRoot, "endpoints", file), "utf8"));
  const refs = response.content?.["application/json"]?.schema?.oneOf ?? [];
  errorSets[basename(file, errorSetSuffix)] = refs.map(({ $ref }) => {
    const known = codeBySchema.get(basename(String($ref)));
    if (!known) throw new Error(`${file} references ${$ref}, which is no error schema`);
    return known.code;
  });
}

await writeFile(
  resolve(outputDir, "errors.mjs"),
  `export default ${JSON.stringify({ codes: [...codeBySchema.values()], errorSets }, null, 2)};\n`,
);
await writeFile(
  resolve(outputDir, "errors.d.mts"),
  [
    'import type { ErrorCatalog } from "../lib/error-reference.ts";',
    "",
    "declare const catalog: ErrorCatalog;",
    "export default catalog;",
    "",
  ].join("\n"),
);
