import { AbstractCLIScaffolder, type ScaffoldOptions, type ScaffolderResult } from "../types";

/**
 * Vue scaffolder stub.
 * Not yet active — uncomment in scaffolders/index.ts to enable.
 */
export class VueScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Vue";
  readonly supportedFrameworks: readonly string[] = ["vue"];

  /** Not yet implemented. */
  async scaffold(_cwd: string, _framework: string, _opts: ScaffoldOptions): Promise<ScaffolderResult> {
    throw new Error("VueScaffolder is not yet implemented");
  }
}
