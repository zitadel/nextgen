import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test as base } from "vitest";

/**
 * `test` with the resources the specs of this package need: a test that names one in its first
 * argument gets it, and the teardown runs after the test whether it passed or not.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 */
export const it = base.extend<{ dir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async dir({}, use) {
    const dir = await mkdtemp(join(tmpdir(), "sdk-nuxt-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
});
