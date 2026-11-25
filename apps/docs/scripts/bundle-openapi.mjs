/**
 * Builds the docs OpenAPI modules from the committed server embed
 * (apps/api/api/openapi/bundled/openapi.json) plus the MIT OpenAPI error YAML.
 * One Redocly bundle (written by server generate) is the source for both the
 * served and the published document.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "@redocly/openapi-core";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(docsRoot, "../..");
const SPEC_ROOT = resolve(repoRoot, "apps/api/api/openapi");
const API_BUNDLE = resolve(SPEC_ROOT, "bundled/openapi.json");
const DOCS_OUT = resolve(docsRoot, ".generated");

async function main() {
  const document = JSON.parse(await readFile(API_BUNDLE, "utf8"));
  for (const parameter of Object.values(document.components?.parameters ?? {})) {
    if (parameter.in === "query" && parameter.name === "project_id" && !parameter.required) {
      delete parameter.example;
      delete parameter.examples;
    }
  }

  await mkdir(DOCS_OUT, { recursive: true });
  await writeFile(
    resolve(DOCS_OUT, "openapi.mjs"),
    `export default ${JSON.stringify(document, null, 2)};\n`,
  );
  await writeFile(
    resolve(DOCS_OUT, "openapi.d.mts"),
    [
      'import type { OpenAPIV3_1 } from "fumadocs-openapi";',
      "",
      "declare const document: OpenAPIV3_1.Document;",
      "export default document;",
      "",
    ].join("\n"),
  );

  await writeErrorCatalog();
  console.log(`wrote ${DOCS_OUT}/openapi.mjs and errors.mjs`);
}

async function writeErrorCatalog() {
  const schemasDir = join(SPEC_ROOT, "components/schemas/errors");
  const codeBySchema = new Map();
  for (const name of (await readdir(schemasDir)).filter((file) => file.endsWith(".yaml")).sort()) {
    const schema = parseYaml(await readFile(join(schemasDir, name), "utf8"));
    const code = schema.allOf?.find((part) => part.properties?.code)?.properties.code.const;
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
  const endpoints = (await readdir(join(SPEC_ROOT, "endpoints"), { recursive: true }))
    .filter((file) => file.endsWith(errorSetSuffix))
    .sort();
  for (const file of endpoints) {
    const response = parseYaml(await readFile(join(SPEC_ROOT, "endpoints", file), "utf8"));
    const refs = response.content?.["application/json"]?.schema?.oneOf ?? [];
    errorSets[basename(file, errorSetSuffix)] = refs.map(({ $ref }) => {
      const known = codeBySchema.get(basename(String($ref)));
      if (!known) throw new Error(`${file} references ${$ref}, which is no error schema`);
      return known.code;
    });
  }

  await writeFile(
    resolve(DOCS_OUT, "errors.mjs"),
    `export default ${JSON.stringify({ codes: [...codeBySchema.values()], errorSets }, null, 2)};\n`,
  );
  await writeFile(
    resolve(DOCS_OUT, "errors.d.mts"),
    [
      'import type { ErrorCatalog } from "../lib/error-reference.ts";',
      "",
      "declare const catalog: ErrorCatalog;",
      "export default catalog;",
      "",
    ].join("\n"),
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
