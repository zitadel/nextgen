import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { removeInstall } from "./remove-install";

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

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      ["-y", "create-solid@latest", ".", "basic", "--solidstart", "--ts", "--v2"],
      cwd,
    );
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
    // `create-solid` installs with pnpm, leaving a pnpm-lock.yaml that pins the
    // public registry. Remove the install so setup picks npm (no lockfile) and
    // installs the workspace packages from the detected registry instead.
    await removeInstall(cwd);
  }
}
