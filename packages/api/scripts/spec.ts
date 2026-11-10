import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const input = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

/**
 * The load in progress, if any. Hooks that ask for the spec while it is being
 * bundled share that one load; once it settles nothing is kept, so a hook that
 * runs later, as in orval's watch mode after an edit, reads the spec again.
 */
let inFlight: Promise<unknown> | undefined;

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
  if (inFlight === undefined) {
    const load: Promise<unknown> = loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") })
      .then(async (config) => {
        const { bundle: result } = await bundle({ ref: input, config, dereference: true });
        return result.parsed;
      })
      .finally(() => {
        if (inFlight === load) {
          inFlight = undefined;
        }
      });
    inFlight = load;
  }
  return inFlight;
}
