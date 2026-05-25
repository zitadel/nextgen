import type { PatchContext, Patcher } from "../types";
import type { ScaffoldResult } from "../legacy/file-writer/plan";

/**
 * LLM-based patcher stub. Uses an AI agent to detect the framework and apply
 * the Zitadel integration via generated code edits.
 *
 * Not yet active — uncomment in patchers/index.ts to enable.
 */
export class LLMPatcher implements Patcher {
  /** Returns false until the LLM patcher is activated. */
  canPatch(_framework: string): boolean {
    return false;
  }

  /** Not yet implemented. */
  async patch(_ctx: PatchContext): Promise<ScaffoldResult> {
    throw new Error("LLM patcher is not yet implemented");
  }
}
