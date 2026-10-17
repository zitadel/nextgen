import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new TanStack Start app with the TanStack CLI, then removes the
 * starter `src/routes/index.tsx` so the patcher can write the managed landing
 * page without colliding with boilerplate.
 *
 * Uses `create-start-app` in its default (full TanStack Start) mode — NOT
 * `create-tsrouter-app --add-ons start`, which produces a router-only SPA
 * without `@tanstack/react-start` (so the detector would not recognise it).
 * `--framework react` selects the React variant; `--no-examples`/`--no-toolchain`
 * keep the output minimal. `vite.config.*` is left in place — auth is wired
 * through `src/start.ts` (the framework's server entry, which the patcher
 * writes), so no config edit is needed.
 */
export class TanStackStartScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "TanStack Start";
  readonly supportedFrameworks: ReadonlyArray<string> = ["tanstack-start"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        "create-start-app@latest",
        ".",
        "--framework",
        "react",
        "--no-examples",
        "--no-toolchain",
        "--no-git",
        "-y",
      ],
      cwd,
    );
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
  }
}
