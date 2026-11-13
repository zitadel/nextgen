import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { frameworkCli } from "./framework-clis";
import type { NodeEngines } from "./node-engines";

/**
 * The TanStack CLI release setup runs. It still writes the packages its
 * templates name at `latest` at the version npmjs reports when it runs.
 */
const TANSTACK_CLI = frameworkCli("@tanstack/cli");

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
 * no config edit is needed. It installs nothing: setup's own install step
 * does, once, and not under `--skip-install`.
 */
export class TanStackStartScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "TanStack Start";
  readonly supportedFrameworks: ReadonlyArray<string> = ["tanstack-start"];

  readonly nodeEngines: NodeEngines = {
    label: "@tanstack/cli",
    spec: TANSTACK_CLI,
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [TANSTACK_CLI];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        TANSTACK_CLI,
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
        // Setup installs once, after it has added the SDKs, and not at all
        // under --skip-install; an install here would ignore that flag.
        "--no-install",
      ],
      cwd,
    );
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
  }
}
