import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";
import type { ConnectionEndpoints } from "@zitadel/config/idp";

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
 * Both credentials are required. Choosing a provider and then withholding one
 * scaffolds a sign-in button that cannot work: the connection document stores
 * `${{ NAME }}` references, and the engine resolves them from the project's
 * variables, so a missing value fails at the provider with `invalid_client`
 * long after setup reported success. Declining the provider is the answer for
 * "not now" — `auth-method sso enable` adds it once the OAuth application
 * exists.
 *
 * Neither value is ever written to a `.zitadel/` file.
 */
export type SsoAnswer = {
  readonly provider: string;
  readonly clientId: string;
  readonly secret: string;
  /**
   * Where the connection points, when not at the vendor. Asked for only on a
   * development run (ZITADEL_CLI_DEV), whose one job is standing the provider
   * up locally — see {@link import("./social-sign-in").SocialSignInPrompt}.
   */
  readonly endpoints?: ConnectionEndpoints;
};

export type SetupAnswers = {
  server: string;
  devPort: number;
  /** Sign-in preset (flow + auth methods); see `SETUP_PRESETS` in @zitadel/config. */
  preset: SetupPreset;
  /** Use case (schema field set); see `SETUP_USE_CASES` in @zitadel/config. */
  useCase: SetupUseCase;
  /**
   * Social providers to enable while scaffolding, empty for email sign-in only.
   * Chosen by {@link import("./social-sign-in").SocialSignInPrompt};
   * `auth-method sso enable` adds one to an existing Project later, so this is
   * never the only way in.
   *
   * A list because a project may offer several at once, and the schema and
   * flow already carry `sso_providers` as a list of slugs — one answer per
   * provider, each with its own credentials.
   */
  sso: readonly SsoAnswer[];
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
   * Whether `--sso` was passed explicitly. When set, the flag answers the
   * provider question and {@link import("./social-sign-in").SocialSignInPrompt}
   * does not ask it.
   *
   * The credential questions are a separate matter: the prompt still asks for
   * a client id or secret the invocation did not supply, because a connection
   * missing either is one that cannot work. Only a `--non-interactive` run has
   * nobody to ask, and that one is refused rather than left incomplete.
   */
  readonly ssoFromFlag?: boolean;
  /**
   * Whether this is a development run (the ZITADEL_CLI_DEV opt-in). Only a
   * development run asks where a provider's endpoints are — see
   * {@link import("./social-sign-in").SocialSignInPrompt}. Passed in rather
   * than read from the bundle so a test can drive both answers.
   */
  readonly developmentBuild?: boolean;
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
