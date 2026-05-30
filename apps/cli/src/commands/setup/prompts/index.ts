/**
 * Public surface for the setup wizard prompts. The `setup` command imports
 * {@link SETUP_PROMPTS} and iterates every entry, threading the answers
 * through each prompt's `ask` so they decide whether to actually ask the
 * user. Add a new question by writing a class and appending an instance to
 * the registry below.
 *
 * {@link PickFrameworkPrompt} is intentionally **not** in `SETUP_PROMPTS` —
 * it runs at the empty-directory scaffold branch, before the main wizard
 * starts.
 */
import { AuthMethodPrompt } from "./auth-method";
import { DevPortPrompt } from "./dev-port";
import { FrameworkConfirmPrompt } from "./framework-confirm";
import { ServerPrompt } from "./server";
import type { SetupPrompt } from "./types";

export type { PromptContext, SetupAnswers, SetupPrompt } from "./types";
export { bail } from "./cancel";
export { AuthMethodPrompt } from "./auth-method";
export { DevPortPrompt } from "./dev-port";
export { FrameworkConfirmPrompt } from "./framework-confirm";
export { ServerPrompt } from "./server";
export { PickFrameworkPrompt } from "./pick-framework";

/** Every question the main setup wizard asks, in ask order. */
export const SETUP_PROMPTS: ReadonlyArray<SetupPrompt> = [
  new FrameworkConfirmPrompt(),
  new AuthMethodPrompt(),
  new ServerPrompt(),
  new DevPortPrompt(),
];
