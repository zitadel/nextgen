import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const input = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

/**
 * How long a loaded spec is shared. orval runs every hook of one generation in
 * one process within seconds, and bundling the whole spec takes seconds, so
 * the hooks share one load; a process that outlives the generation, such as
 * orval's watch mode, reads the spec again once the share has lapsed.
 */
const SHARED_FOR_MS = 30_000;

/**
 * The bundled spec and when it was asked for.
 */
let loaded: { readonly at: number; readonly spec: Promise<unknown> } | undefined;

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
  const now = Date.now();
  if (loaded === undefined || now - loaded.at > SHARED_FOR_MS) {
    const spec = loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") }).then(
      async (config) => {
        const { bundle: result } = await bundle({ ref: input, config, dereference: true });
        return result.parsed;
      },
    );
    loaded = { at: now, spec };
  }
  return loaded.spec;
}
