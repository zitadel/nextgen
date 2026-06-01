import { AbstractCLIScaffolder } from "./cli";

/** Scaffolds a new Next.js App Router project with `create-next-app`. */
export class NextScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Next.js";
  readonly supportedFrameworks: ReadonlyArray<string> = ["next"];

  /**
   * Runs `npx create-next-app@latest . --ts --app --no-git --yes` in `cwd`,
   * creating a TypeScript App Router project in place. `--yes` accepts all
   * defaults so the command runs unattended.
   */
  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      ["create-next-app@latest", ".", "--ts", "--app", "--no-git", "--yes"],
      cwd,
    );
  }
}
