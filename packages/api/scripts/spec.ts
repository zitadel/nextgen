import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

/** This package's root. */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The repository's root. */
export const repoRoot = resolve(packageRoot, "../..");
/** The OpenAPI source, which `$ref`s into one file per endpoint. */
export const specInput = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

/**
 * The spec, bundled with the repo's redocly.yaml as the docs bundle it
 * (scripts/bundle-openapi.mjs) and dereferenced, so a parameter or a schema is
 * read where it is used.
 *
 * @remarks
 * Bundling and dereferencing the whole document is the slowest part of the
 * orval hook, so the hook loads it once and hands the same copy to every
 * writer, which only reads it. It is not cached here, so a hook that runs again
 * in one process reads the spec as it is then.
 */
export async function loadSpec(): Promise<unknown> {
  const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
  const { bundle: result } = await bundle({ ref: specInput, config, dereference: true });
  return result.parsed;
}
