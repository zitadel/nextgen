import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Vite + Vue (TypeScript) single-page app with `create-vite`,
 * then removes the starter `App.vue`/`components/HelloWorld.vue` demo so the
 * patcher can write the managed `src/App.vue` without colliding with boilerplate.
 */
export class VueScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Vue (Vite)";
  readonly supportedFrameworks: ReadonlyArray<string> = ["vue"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npm", ["create", "vite@latest", ".", "--", "--template", "vue-ts"], cwd);
    await rm(join(cwd, "src/App.vue"), { force: true });
    await rm(join(cwd, "src/components/HelloWorld.vue"), { force: true });
  }
}
