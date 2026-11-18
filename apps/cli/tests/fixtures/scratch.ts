import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

/**
 * Gives every directory under a path its owner's permissions back, so a test
 * that took them away (to see how a directory no one may read is refused) does
 * not leave a tree that cannot be removed. A file needs none: removing one
 * depends only on the directory it is in.
 *
 * @param path - The path to unlock, with everything under it.
 * @returns Once every directory under the path can be entered and listed.
 */
async function unlock(path: string): Promise<void> {
  const stats = await lstat(path).catch(() => {
    return undefined;
  });
  if (stats === undefined || !stats.isDirectory()) {
    return;
  }
  await chmod(path, 0o755);
  for (const name of await readdir(path)) {
    await unlock(join(path, name));
  }
}

/**
 * Removes a tree, giving back the permissions a test took away if the first
 * attempt is refused, and retrying a directory that a late write refilled.
 *
 * @param path - The directory to remove, with everything under it.
 * @returns Once the tree is gone.
 */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(async () => {
    await unlock(path);
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  });
}

/**
 * A fresh temp directory that is removed when the test ends, for a helper that
 * has to hand a test a directory of its own making. A test that wants a
 * directory asks for the `dir` fixture instead.
 *
 * @param prefix - What the directory's name starts with.
 * @returns The directory's path.
 */
export async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => {
    return removeTree(dir);
  });
  return dir;
}
