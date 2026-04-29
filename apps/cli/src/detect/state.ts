import { stat } from "node:fs/promises";
import { join } from "node:path";

export async function hasZitadelConfig(cwd: string): Promise<boolean> {
  return exists(join(cwd, "zitadel.json"));
}

export async function hasZitadelSecret(cwd: string): Promise<boolean> {
  return exists(join(cwd, ".zitadel/secret"));
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
