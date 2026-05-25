import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Returns true when the working directory contains no `package.json`, indicating
 * it is an empty (or non-Node.js) project that should be scaffolded from scratch.
 */
export async function detectEmptyProject(cwd: string): Promise<boolean> {
  try {
    await readFile(join(cwd, "package.json"), "utf8");
    return false;
  } catch {
    return true;
  }
}
