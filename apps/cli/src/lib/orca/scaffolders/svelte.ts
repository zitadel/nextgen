import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { CREATE_VITE_NODE_ENGINES, CREATE_VITE_VERSION } from "./node-engines";

/**
 * Scaffolds a new Vite + Svelte (TypeScript) single-page app with `create-vite`,
 * then removes the starter `App.svelte`/`lib/Counter.svelte` demo so the patcher
 * can write the managed `src/App.svelte` without colliding with boilerplate.
 * `app.css` and `main.ts` are left in place — the patched `App.svelte` keeps the
 * same entry.
 */
export class SvelteScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Svelte (Vite)";
  readonly supportedFrameworks: ReadonlyArray<string> = ["svelte"];
  readonly nodeEngines = CREATE_VITE_NODE_ENGINES;
  override readonly pinnedPackages: ReadonlyArray<string> = [CREATE_VITE_NODE_ENGINES.spec];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npm",
      ["create", `vite@${CREATE_VITE_VERSION}`, ".", "--", "--template", "svelte-ts"],
      cwd,
    );
    await rm(join(cwd, "src/App.svelte"), { force: true });
    await rm(join(cwd, "src/lib/Counter.svelte"), { force: true });
  }
}
