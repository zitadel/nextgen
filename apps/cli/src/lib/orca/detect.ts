import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { detectFramework, type FrameworkDetection } from "../../detect/framework";

/**
 * Returns true when the directory has no `package.json`, i.e. it is empty (or
 * non-Node) and should be scaffolded from scratch rather than patched.
 */
export async function detectEmptyProject(cwd: string): Promise<boolean> {
  try {
    await readFile(join(cwd, "package.json"), "utf8");
    return false;
  } catch {
    return true;
  }
}

/**
 * Detects the framework without throwing, returning `null` when none is found.
 * Lets callers (e.g. `eject`) probe the project shape and degrade gracefully
 * instead of catching {@link detectFramework}'s error.
 */
export async function tryDetectFramework(cwd: string): Promise<FrameworkDetection | null> {
  try {
    return await detectFramework(cwd);
  } catch {
    return null;
  }
}
