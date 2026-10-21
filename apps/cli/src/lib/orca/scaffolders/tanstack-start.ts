import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import type { NodeEngines } from "./node-engines";

/**
 * Scaffolds a new TanStack Start app with the TanStack CLI, then removes the
 * starter `src/routes/index.tsx` so the patcher can write the managed landing
 * page without colliding with boilerplate.
 *
 * Uses `@tanstack/cli create` (which replaces the deprecated
 * `create-start-app`) in its default (full TanStack Start) mode — NOT
 * `--router-only`, which produces a router-only SPA without
 * `@tanstack/react-start` (so the detector would not recognise it).
 * `--framework react` selects the React variant, `--deployment nitro` keeps the
 * Nitro target, and `--no-examples`/`--no-toolchain`/`--no-intent` keep the
 * output minimal. `vite.config.*` is left in place — auth is wired through
 * `src/start.ts` (the framework's server entry, which the patcher writes), so
 * no config edit is needed.
 */
export class TanStackStartScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "TanStack Start";
  readonly supportedFrameworks: ReadonlyArray<string> = ["tanstack-start"];

  readonly nodeEngines: NodeEngines = {
    label: "@tanstack/cli",
    spec: "@tanstack/cli@latest",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
  };

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        "@tanstack/cli@latest",
        "create",
        ".",
        "--framework",
        "react",
        "--deployment",
        "nitro",
        "--no-examples",
        "--no-toolchain",
        "--no-intent",
        "--no-git",
        "-y",
      ],
      cwd,
    );
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
  }
}
