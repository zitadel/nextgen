import { syncMetaSchemas } from "./scripts/sync-meta-schemas.mjs";

/**
 * Copy the server's dialect meta-schemas into `meta-schemas/` before the suite
 * runs, so `src/meta-schemas.ts` (which the tests may pull in) never imports a
 * stale or missing copy. Keeps `test` = `vitest run`, self-sufficient, with no
 * script chained ahead of it. The moon `sync-schemas` task remains for the
 * build/typecheck cache graph; this copy is idempotent, so both can run.
 */
export default function setup() {
  syncMetaSchemas();
}
