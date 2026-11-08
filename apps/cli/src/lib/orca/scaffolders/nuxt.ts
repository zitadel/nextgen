import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { frameworkCli } from "./framework-clis";
import type { NodeEngines } from "./node-engines";

const NUXI = frameworkCli("nuxi");

/**
 * The Nuxt starter `nuxi init` extracts: the `minimal` template's source (the
 * `v4` branch of nuxt/starter), at a fixed commit. `--template minimal` would
 * download the branch's head from GitHub, which moves its `nuxt` floor within
 * hours of a Nuxt release and will move to Nuxt 5 with it, outside any pin.
 * codeload serves the commit's tarball, as the template registry's own entry
 * does, without the GitHub API's rate limit. Move it to a newer commit of the
 * branch the `minimal` template names
 * (https://raw.githubusercontent.com/nuxt/starter/templates/templates/minimal.json).
 */
const NUXT_STARTER =
  "https://codeload.github.com/nuxt/starter/tar.gz/db01806fcb37f2e369fb09443c72cac696b31548";

/**
 * Scaffolds a new Nuxt app with `nuxi init`, then removes the starter `app.vue`
 * so the patcher can write the managed one without colliding with boilerplate.
 * Nuxt 4 (what the starter scaffolds) puts it under `app/`; older Nuxt put it at
 * the root, so both are removed. `nuxt.config.ts` is left in place — the
 * patcher merges into it via an `edit`, which preserves whatever `nuxi` generated.
 */
export class NuxtScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Nuxt";
  readonly supportedFrameworks: ReadonlyArray<string> = ["nuxt"];
  readonly nodeEngines: NodeEngines = {
    label: "nuxi",
    spec: NUXI,
    fallback: "^22.21.0 || ^24.11.0 || >=26.0.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [NUXI];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        NUXI,
        "init",
        ".",
        "--template",
        NUXT_STARTER,
        "--packageManager",
        "npm",
        "--no-gitInit",
        "--force",
      ],
      cwd,
    );
    await rm(join(cwd, "app/app.vue"), { force: true });
    await rm(join(cwd, "app.vue"), { force: true });
  }
}
