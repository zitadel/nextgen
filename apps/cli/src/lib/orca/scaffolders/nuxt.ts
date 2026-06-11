import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Nuxt app with `nuxi init`, then removes the starter `app.vue`
 * so the patcher can write the managed one without colliding with boilerplate.
 * `nuxt.config.ts` is left in place — the patcher merges into it via an `edit`,
 * which preserves whatever `nuxi` generated.
 */
export class NuxtScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Nuxt";
  readonly supportedFrameworks: ReadonlyArray<string> = ["nuxt"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        "nuxi@latest",
        "init",
        ".",
        "--template",
        "minimal",
        "--packageManager",
        "npm",
        "--no-gitInit",
        "--force",
      ],
      cwd,
    );
    await rm(join(cwd, "app.vue"), { force: true });
  }
}
