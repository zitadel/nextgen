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
   * The environments the app runs in and where each points, from the
   * {@link import("./environments").EnvironmentsPrompt}. Absent (flags or
   * non-interactive runs) means the patcher writes its default map: every
   * environment on the setup server sharing the one project.
   */
  environments?: EnvironmentAnswer[];
};

/** One environment as answered in the wizard, before projects exist. */
export type EnvironmentAnswer = {
  name: string;
  /**
   * Server origin or `local`. Ignored when `sharesProjectOf` is set: the
   * environment then lives wherever that project lives.
   */
  server: string;
  /**
   * Own project with its own users, created by setup. Neither this nor
   * `sharesProjectOf` means the development project (the one setup creates
   * first).
   */
  isolated: boolean;
  /**
   * Name of the environment whose project this one shares: previews live
   * on production's project so they run against real-shaped data.
   */
  sharesProjectOf?: string;
  /**
   * Where the frontend runs for this environment: bare origins or a
   * leftmost-label wildcard (`https://*.vercel.app`). Registered on the
   * project's origin allowlist and written to `zitadel.json`.
   */
  origins?: string[];
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
