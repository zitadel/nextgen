import { AbstractLLMScaffolder, type ScaffoldOptions, type ScaffolderResult } from "../types";

/**
 * LLM-based scaffolder stub.
 * Not yet active — uncomment in scaffolders/index.ts to enable.
 */
export class LLMScaffolder extends AbstractLLMScaffolder {
  readonly displayName = "AI-generated";
  readonly supportedFrameworks: readonly string[] = ["*"];

  /** Not yet implemented. */
  async scaffold(_cwd: string, _framework: string, _opts: ScaffoldOptions): Promise<ScaffolderResult> {
    throw new Error("LLMScaffolder is not yet implemented");
  }
}
