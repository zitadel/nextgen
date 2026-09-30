import { syncMetaSchemas } from "./packages/config/scripts/sync-meta-schemas.mjs";

/**
 * The single, shared Vitest global setup for the whole workspace — referenced by
 * `vitest.shared.mjs` so every project runs the same one from a consistent
 * location, rather than each package pointing at its own file in its own place.
 *
 * It prepares the workspace's generated test inputs: the server's dialect
 * meta-schemas copied into `packages/config/meta-schemas/` (which `@zitadel/config`
 * imports, directly or transitively). The copy is idempotent and cheap, so
 * running it ahead of every suite is harmless. Package build steps that tests
 * depend on (e.g. the CLI's dist) are guaranteed by moon task `deps`, not here.
 */
export default function setup() {
  syncMetaSchemas();
}
