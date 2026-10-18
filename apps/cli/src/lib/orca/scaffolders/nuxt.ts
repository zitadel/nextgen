import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import type { NodeEngines } from "./node-engines";

/**
 * Scaffolds a new Nuxt app with `nuxi init`, then removes the starter `app.vue`
 * so the patcher can write the managed one without colliding with boilerplate.
 * Nuxt 4 (what `nuxi init` scaffolds today) puts it under `app/`; older Nuxt put
 * it at the root, so both are removed. `nuxt.config.ts` is left in place — the
 * patcher merges into it via an `edit`, which preserves whatever `nuxi` generated.
 */
export class NuxtScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Nuxt";
  readonly supportedFrameworks: ReadonlyArray<string> = ["nuxt"];
  readonly nodeEngines: NodeEngines = {
    label: "nuxi",
    spec: "nuxi@latest",
    fallback: "^22.21.0 || ^24.11.0 || >=26.0.0",
    enforcement: "warn",
  };

  protected async create(cwd: string, _framework: string): Promise<void> {
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
    await rm(join(cwd, "app/app.vue"), { force: true });
    await rm(join(cwd, "app.vue"), { force: true });
  }
}
