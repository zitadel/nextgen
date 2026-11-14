import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { frameworkCli } from "./framework-clis";
import type { NodeEngines } from "./node-engines";
import { removeInstall } from "./remove-install";

/**
 * The `create-solid` release setup runs. It still takes the template itself
 * from the head of the solidjs/templates repository on GitHub.
 */
const CREATE_SOLID = frameworkCli("create-solid");

/**
 * Scaffolds a new SolidStart app with `create-solid`, then removes the starter
 * `src/routes/index.tsx` so the patcher can write the managed landing page
 * without colliding with boilerplate. `vite.config.ts` is left in place — the
 * patcher merges into it via an `edit` (adding `middleware` to the
 * `solidStart()` plugin), which preserves whatever `create-solid` generated.
 *
 * The flags pin a non-interactive run: `create-solid` otherwise prompts for the
 * project type, SolidStart version, and template. `--solidstart --ts --v2` plus
 * the `basic` template positional select a TypeScript SolidStart 2 app (the
 * version `create-solid` now ships and recommends) without any prompts.
 */
export class SolidStartScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "SolidStart";
  readonly supportedFrameworks: ReadonlyArray<string> = ["solid-start"];

  readonly nodeEngines: NodeEngines = {
    label: "create-solid",
    spec: CREATE_SOLID,
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [CREATE_SOLID];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npx", ["-y", CREATE_SOLID, ".", "basic", "--solidstart", "--ts", "--v2"], cwd);
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
    // `create-solid` installs with pnpm, leaving a pnpm-lock.yaml that pins the
    // public registry. Remove the install so setup picks npm (no lockfile) and
    // installs the workspace packages from the detected registry instead.
    await removeInstall(cwd);
  }
}
