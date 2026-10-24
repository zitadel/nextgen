import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Removes a scaffolder's auto-generated dependency install — `node_modules` and
 * every lockfile shape. Some `create-*` tools (e.g. `create-solid`,
 * `create-qwik`) install dependencies as part of scaffolding, leaving a
 * lockfile that pins the public registry. Setup detects the package manager from
 * that lockfile and would then install the workspace packages from the wrong
 * registry. Removing the install leaves no lockfile, so setup falls back to npm
 * and installs from the registry it is pointed at.
 */
export async function removeInstall(cwd: string): Promise<void> {
  await Promise.all(
    ["node_modules", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"].map((entry) =>
      rm(join(cwd, entry), { recursive: true, force: true }),
    ),
  );
}
