import { AbstractCLIScaffolder, type ScaffoldOptions, type ScaffolderResult } from "../types";

/** Scaffolds a new Nuxt project using the official nuxi CLI. */
export class NuxtScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Nuxt";
  readonly supportedFrameworks: readonly string[] = ["nuxt"];

  /**
   * Runs `npx nuxi@latest init . --template minimal --package-manager pnpm --no-install
   * --no-git-init` in the target directory, creating a minimal Nuxt project in-place.
   * Explicit flags prevent all interactive prompts so the command runs unattended.
   */
  async scaffold(cwd: string, _framework: string, opts: ScaffoldOptions): Promise<ScaffolderResult> {
    const pm = opts.packageManager ?? "pnpm";
    this.runCommand(
      "npx",
      [
        "nuxi@latest",
        "init",
        ".",
        "--template",
        "minimal",
        "--package-manager",
        pm,
        "--no-install",
        "--no-git-init",
      ],
      cwd,
    );
    return { ok: true };
  }
}
