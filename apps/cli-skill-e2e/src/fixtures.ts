import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

/**
 * `it` with a `dir` fixture: a fresh temp directory the test receives and that is removed when
 * the test ends, whether it passed or not.
 */
export const it = test.extend<{ dir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  dir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), "transcript-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
});
