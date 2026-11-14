import {
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";

import { WizardStep } from "@/lib/wizard";

import type { Fact } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "found" | "ssoFromCommandLine" | "preflight">;

/**
 * Seeds the answers from the flags and the defaults, so each question can decide
 * whether to ask.
 */
export class ApplyDefaults extends WizardStep<"defaults", Fact<"app" | "answers">, Needs> {
  readonly key = "defaults";

  /**
   * Take what the flags answered and the defaults for the rest.
   *
   * @remarks
   * An explicit --dev-port overrides the detected port for the whole run, so the issuer and the
   * registered origin track the requested port (and several apps can be scaffolded on distinct
   * ports). The config edits set the dev-server port only when it is unset, so a project that
   * already pins a different port in vite.config.* or angular.json keeps it — pass --dev-port to match
   * that pin (or remove it) if the origin check rejects requests.
   *
   * @param needs - The flags, what detection found and the provider asked for.
   * @param this.deps - What the command provides.
   * @returns The app with the port the run uses, and the answers so far.
   */
  async run(needs: Needs): Promise<Fact<"app" | "answers">> {
    const { flags, found, ssoFromCommandLine } = needs;
    const app =
      flags.devPort === undefined
        ? found.app
        : {
            ...found.app,
            devPort: flags.devPort,
          };
    return {
      app,
      answers: {
        server: needs.preflight.server.value,
        devPort: app.devPort,
        preset: (flags.preset as SetupPreset | undefined) ?? DEFAULT_SETUP_PRESET,
        useCase: (flags.useCase as SetupUseCase | undefined) ?? DEFAULT_SETUP_USE_CASE,
        sso: ssoFromCommandLine === undefined ? [] : [ssoFromCommandLine],
        passwordMinLength: flags.passwordMinLength,
      },
    };
  }
}
