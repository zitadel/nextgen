import { test as base } from "./http";
import { nextPort } from "./ports";

/**
 * `test` with a port for a test that hands one to the CLI. It lives beside, not in, `ports.ts`:
 * `vitest.config.ts` reads that file's allocator while the config loads, where a Vitest `test`
 * cannot be extended.
 *
 * - `port` is a port from this worker's own block (see `ports.ts`). A test that needs a second one
 *   calls `nextPort()`.
 */
export const test = base.extend<{ port: number }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  port: ({}, use) => use(nextPort()),
});
