import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Package managers the CLI can emit install/run commands for.
 */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/**
 * Infers the project's package manager from the lockfile present in `cwd`.
 * Lockfiles are checked in a fixed priority order, and npm is the default when
 * none is found so generated commands always have a usable runner.
 */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  if (await exists(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await exists(join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  if (await exists(join(cwd, "bun.lockb"))) {
    return "bun";
  }
  if (await exists(join(cwd, "package-lock.json"))) {
    return "npm";
  }
  return "npm";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
