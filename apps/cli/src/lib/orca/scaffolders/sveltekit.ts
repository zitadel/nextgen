import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { frameworkCli } from "./framework-clis";
import type { NodeEngines } from "./node-engines";

const SV = frameworkCli("sv");

/**
 * Scaffolds a new SvelteKit app with the `sv` CLI (`sv create`), then removes
 * the starter `src/routes/+page.svelte` and `src/routes/+layout.svelte` so the
 * patcher can write its managed landing page and layout without colliding with
 * boilerplate (the file-writer refuses to overwrite an unmarked file unless
 * `--force`). `svelte.config.js` and `vite.config.*` are left in place — the
 * SvelteKit integration wires auth through `src/hooks.server.ts` (a plain file
 * the patcher writes), so no config edit is needed. It installs nothing:
 * setup's own install step does, once, and not under `--skip-install`.
 */
export class SvelteKitScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "SvelteKit";
  readonly supportedFrameworks: ReadonlyArray<string> = ["sveltekit"];

  readonly nodeEngines: NodeEngines = {
    label: "sv",
    spec: SV,
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [SV];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        SV,
        "create",
        ".",
        "--template",
        "minimal",
        "--types",
        "ts",
        "--no-add-ons",
        // Setup installs once, after it has added the SDKs, and not at all
        // under --skip-install; an install here would ignore that flag.
        "--no-install",
      ],
      cwd,
    );
    await rm(join(cwd, "src/routes/+page.svelte"), { force: true });
    await rm(join(cwd, "src/routes/+layout.svelte"), { force: true });
  }
}
