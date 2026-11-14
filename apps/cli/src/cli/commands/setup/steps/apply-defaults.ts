import { WizardStep } from "@/lib/wizard";

import { type Fact, variantOf } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "found" | "ssoFromCommandLine" | "preflight">;

/**
 * Seeds the answers from the flags and the defaults, so each question can decide
 * whether to ask.
 *
 * @remarks
 * The flags are checked against their options before the wizard runs, so one
 * that is set is always one of the known presets or use cases.
 */
export class ApplyDefaults extends WizardStep<"defaults", Fact<"app" | "answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "defaults";

  /**
   * Take what the flags answered and the defaults for the rest.
   *
   * @remarks
   * An explicit `--dev-port` overrides the detected port for the whole run, so the issuer and the
   * registered origin track the requested port, and several apps can be scaffolded on distinct
   * ports. The config edits set the dev-server port only when it is unset, so a project that
   * already pins a different port in `vite.config.*` or `angular.json` keeps it: pass `--dev-port`
   * to match that pin, or remove it, if the origin check rejects requests.
   *
   * @param needs - The flags, what detection found and the provider asked for.
   * @returns The app with the port the run uses, and the answers so far.
   */
  async run(needs: Needs): Promise<Fact<"app" | "answers">> {
    const { flags, found, preflight, ssoFromCommandLine } = needs;
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
        server: preflight.server.value,
        devPort: app.devPort,
        ...variantOf(flags),
        sso: ssoFromCommandLine === undefined ? [] : [ssoFromCommandLine],
        passwordMinLength: flags.passwordMinLength,
      },
    };
  }
}
