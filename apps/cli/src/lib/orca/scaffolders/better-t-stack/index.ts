import { AbstractCLIScaffolder, type ScaffoldOptions, type ScaffolderResult } from "../types";

/**
 * Better-T-Stack scaffolder stub.
 * Not yet active — uncomment in scaffolders/index.ts to enable.
 */
export class BetterTStackScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Better-T-Stack";
  readonly supportedFrameworks: readonly string[] = ["better-t-stack"];

  /** Not yet implemented. */
  async scaffold(_cwd: string, _framework: string, _opts: ScaffoldOptions): Promise<ScaffolderResult> {
    throw new Error("BetterTStackScaffolder is not yet implemented");
  }
}
