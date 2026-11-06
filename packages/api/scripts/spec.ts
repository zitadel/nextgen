import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

/** This package's root. */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The repository's root. */
export const repoRoot = resolve(packageRoot, "../..");
/** The OpenAPI source, which `$ref`s into one file per endpoint. */
export const specInput = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

let loaded: Promise<unknown> | undefined;

/**
 * The spec, bundled with the repo's redocly.yaml as the docs bundle it
 * (scripts/bundle-openapi.mjs) and dereferenced, so a parameter or a schema is
 * read where it is used.
 *
 * @remarks
 * Bundling and dereferencing the whole document is the slowest part of the
 * orval hook, so it is done once per run and every writer reads the same copy.
 * Writers only read it.
 */
export function loadSpec(): Promise<unknown> {
  loaded ??= (async () => {
    const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
    const { bundle: result } = await bundle({ ref: specInput, config, dereference: true });
    return result.parsed;
  })();
  return loaded;
}
