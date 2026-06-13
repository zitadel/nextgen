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
  server: string;
  devPort: number;
};

/** Read-only facts a prompt may need (today only the resolved framework). */
export type PromptContext = {
  readonly framework: FrameworkFacts;
  /**
   * The raw `--server` flag value as the user passed it, or `undefined`
   * when not provided. Prompts use this to skip themselves when the flag
   * already pinned the answer (the docstring on `SetupPrompt` says
   * prompts should return unchanged answers in that case). Distinct from
   * `answers.server`, which is *always* populated by the base command's
   * server-resolution chain — checking that alone can't distinguish "user
   * passed a flag" from "we fell back to the cloud default".
   */
  readonly serverFlag?: string;
  /**
   * Whether `--dev-port` was passed explicitly. When set, the flag is
   * authoritative and {@link import("./dev-port").DevPortPrompt} skips itself so
   * an interactive answer can't override a scripted/flagged port.
   */
  readonly devPortFromFlag?: boolean;
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
