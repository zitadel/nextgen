import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reports whether `cwd` has already been initialized, i.e. a committed
 * `zitadel.json` exists. Used to decide whether setup should run or skip.
 */
export async function hasZitadelConfig(cwd: string): Promise<boolean> {
  return exists(join(cwd, "zitadel.json"));
}

/**
 * Reports whether local secret material (`.zitadel/secret`) is present. Gates
 * commands that need credentials, and signals that secrets were already pulled.
 */
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
