import { AbstractCLIScaffolder } from "./cli";

const CREATE_NEXT_APP_VERSION = "16.2.4";

/** Scaffolds a new Next.js App Router project with `create-next-app`. */
export class NextScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Next.js";
  readonly supportedFrameworks: ReadonlyArray<string> = ["next"];

  /**
   * Runs the pinned `create-next-app` version in `cwd`, creating a TypeScript
   * App Router project in place. `--yes` accepts all defaults so the command
   * runs unattended, and `--skip-install` leaves dependency installation to the
   * setup command's explicit next step after Zitadel patches package.json.
   */
  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "--yes",
        `create-next-app@${CREATE_NEXT_APP_VERSION}`,
        ".",
        "--ts",
        "--app",
        "--use-npm",
        "--disable-git",
        "--yes",
        "--skip-install",
      ],
      cwd,
    );
  }
}
