import { AbstractCLIScaffolder, type ScaffoldOptions, type ScaffolderResult } from "../types";

/** Scaffolds a new Next.js App Router project using create-next-app. */
export class NextScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Next.js";
  readonly supportedFrameworks: readonly string[] = ["next"];

  /**
   * Runs `npx create-next-app@latest . --ts --app --no-git --yes` in the
   * target directory, creating a TypeScript App Router project in-place.
   */
  async scaffold(cwd: string, _framework: string, _opts: ScaffoldOptions): Promise<ScaffolderResult> {
    this.runCommand("npx", ["create-next-app@latest", ".", "--ts", "--app", "--no-git", "--yes"], cwd);
    return { ok: true };
  }
}
