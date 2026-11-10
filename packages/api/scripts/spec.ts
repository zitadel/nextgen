import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const input = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

/**
 * The bundled spec, read once: orval runs every hook in one process, and
 * bundling the whole spec takes seconds.
 */
let loaded: Promise<unknown> | undefined;

/**
 * Load the spec as the generation hooks read it.
 *
 * @remarks
 * Bundled with the repo's redocly.yaml, as the docs bundle it
 * (scripts/bundle-openapi.mjs), and dereferenced, so a parameter or a schema
 * is read where it is used. The result may share objects and cycle.
 *
 * @returns The dereferenced spec.
 */
export function loadSpec(): Promise<unknown> {
  loaded ??= loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") }).then(async (config) => {
    const { bundle: result } = await bundle({ ref: input, config, dereference: true });
    return result.parsed;
  });
  return loaded;
}
