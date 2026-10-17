import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new SvelteKit app with the `sv` CLI (`sv create`), then removes
 * the starter `src/routes/+page.svelte` and `src/routes/+layout.svelte` so the
 * patcher can write its managed landing page and layout without colliding with
 * boilerplate (the file-writer refuses to overwrite an unmarked file unless
 * `--force`). `svelte.config.js` and `vite.config.*` are left in place — the
 * SvelteKit integration wires auth through `src/hooks.server.ts` (a plain file
 * the patcher writes), so no config edit is needed.
 */
export class SvelteKitScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "SvelteKit";
  readonly supportedFrameworks: ReadonlyArray<string> = ["sveltekit"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        "sv@latest",
        "create",
        ".",
        "--template",
        "minimal",
        "--types",
        "ts",
        "--no-add-ons",
        "--install",
        "npm",
      ],
      cwd,
    );
    await rm(join(cwd, "src/routes/+page.svelte"), { force: true });
    await rm(join(cwd, "src/routes/+layout.svelte"), { force: true });
  }
}
