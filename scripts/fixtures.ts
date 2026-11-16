import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test as base } from "vitest";

/**
 * Creates a fresh temp directory, hands it to the test and removes it afterwards.
 *
 * @param use - Runs the test with the directory.
 * @returns Resolves once the test ended and the directory is gone.
 */
async function withTempDir(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nextgen-scripts-"));
  await use(dir);
  await rm(dir, { recursive: true, force: true });
}

/**
 * `test` for the script tests, with fixtures a test names in its first argument.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 * - `other` is a second one, for a test that needs two apart.
 * - `fileDir` is one temp directory for the whole test file, removed when the file's last test
 *   ends, for a fixture of file scope that must keep something between tests.
 */
export const test = base.extend<{ dir: string; other: string; fileDir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  dir: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  other: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  fileDir: [({}, use) => withTempDir(use), { scope: "file" }],
});
