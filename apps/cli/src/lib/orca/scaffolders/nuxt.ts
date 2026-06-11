import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Nuxt app with `nuxi init`. The patcher overwrites `app.vue`
 * and `nuxt.config.ts` (both produced by `nuxi`), so no boilerplate cleanup is
 * needed.
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
  }
}
