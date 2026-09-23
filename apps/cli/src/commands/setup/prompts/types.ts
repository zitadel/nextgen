import type { BrandingDesign, SetupPreset, SetupUseCase } from "@zitadel/config/defaults";

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
/**
 * A social provider chosen during setup, with the credentials of the OAuth
 * application the developer registered for it.
 *
 * `secret` is held only long enough to reach `.env.local` and is never written
 * to a `.zitadel/` file — the connection document stores the `${{ NAME }}`
 * reference instead. It is optional because skipping it is a deliberate
 * answer: everything else is scaffolded, and the value can be pasted in later.
 */
export type SsoAnswer = {
  readonly provider: string;
  readonly clientId: string;
  readonly secret?: string;
};

export type SetupAnswers = {
  server: string;
  devPort: number;
  /** Sign-in preset (flow + auth methods); see `SETUP_PRESETS` in @zitadel/config. */
  preset: SetupPreset;
  /** Use case (schema field set); see `SETUP_USE_CASES` in @zitadel/config. */
  useCase: SetupUseCase;
  /**
   * Starter login design to eject into `.zitadel/branding/` and publish as
   * branding revision 1; see `BRANDING_DESIGNS` in @zitadel/config.
   * `undefined` keeps the built-in template and writes no branding files —
   * template ownership stays an explicit opt-in (`branding eject` offers
   * the same choice after setup).
   */
  design?: BrandingDesign;
  /**
   * Social provider to enable while scaffolding, or `undefined` for email
   * sign-in only. Chosen by {@link import("./social-sign-in").SocialSignInPrompt};
   * `sso enable` adds one to an existing Project later, so this is
   * never the only way in.
   */
  sso?: SsoAnswer;
};

/** Read-only facts a prompt may need. */
export type PromptContext = {
  readonly framework: FrameworkFacts;
  /**
   * The app directory setup runs in. {@link import("./server").ServerPrompt}
   * reads the local runtime metadata (`.zitadel/local/runtime.json`) under it
   * to detect a managed local server started here.
   */
  readonly cwd: string;
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
  /**
   * Whether `--preset` was passed explicitly. When set, the flag is
   * authoritative and {@link import("./sign-in-preset").SignInPresetPrompt}
   * skips itself.
   */
  readonly presetFromFlag?: boolean;
  /**
   * Whether `--use-case` was passed explicitly. When set, the flag is
   * authoritative and {@link import("./use-case").UseCasePrompt} skips itself.
   */
  readonly useCaseFromFlag?: boolean;
  /**
   * Whether `--design` was passed explicitly. When set, the flag is
   * authoritative and {@link import("./design").DesignPrompt} skips itself.
   */
  readonly designFromFlag?: boolean;
  /**
   * Whether `--sso` was passed explicitly. When set, the flag is
   * authoritative and {@link import("./social-sign-in").SocialSignInPrompt}
   * skips itself — including the credential questions, which `--sso-client-id`
   * and the piped secret answer.
   */
  readonly ssoFromFlag?: boolean;
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
