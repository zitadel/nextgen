import type { AuthMethod } from "../../../lib/flows";
import type { FrameworkFacts } from "../../../lib/orca";

/**
 * The collected wizard state, threaded through every {@link SetupPrompt}. A
 * prompt updates its own slice (returning a fresh object); the final shape is
 * what setup feeds into the patcher's `PatchContext` and, ultimately, the
 * generated `zitadel.json`.
 *
 * Pre-seeded by the Setup command from flags + framework detection so each
 * prompt can decide whether to ask (skip when its flag is already a valid
 * value, otherwise prompt and write).
 */
export type SetupAnswers = {
  authMethod: AuthMethod | undefined;
  server: string;
  devPort: number;
};

/** Read-only facts a prompt may need (today only the resolved framework). */
export type PromptContext = {
  readonly framework: FrameworkFacts;
};

/**
 * One question (or one logically-grouped block of questions, e.g. server
 * choice + conditional custom URL) the setup wizard asks. Each implementation
 * is a small standalone class; the Setup command iterates every entry in
 * {@link import("./index").SETUP_PROMPTS} in order. A prompt that has nothing
 * to do (its corresponding flag pre-filled a valid value) returns the answers
 * unchanged.
 */
export interface SetupPrompt {
  ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers>;
}
