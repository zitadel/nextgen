import { stat } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  if (await exists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(cwd, "yarn.lock"))) return "yarn";
  if (await exists(join(cwd, "bun.lockb"))) return "bun";
  if (await exists(join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
