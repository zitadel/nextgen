import { SETUP_PRESETS } from "@zitadel/config/defaults";

import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
>;

/**
 * "Which sign-in method would you like your users to see first?" — picks the
 * schema+flow preset the scaffold starts from, before any `.zitadel/` file is
 * written. `--preset` is authoritative; non-interactive runs keep the
 * password-first default seeded by the command.
 */
export class ChooseSignIn extends WizardStep<"signInPreset", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "signInPreset";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask which sign-in method users see first, or leave the answers as they are when nothing can be
   * asked.
   *
   * @remarks
   * Each label says what users see first and what is secondary, because both presets enable
   * password and passkey in the schema: the choice is only which one the login flow shows first.
   *
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, with the preset settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { answers, flags } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun || flags.preset !== undefined) {
      return {
        answers,
      };
    }
    return {
      answers: {
        ...answers,
        preset: await this.deps.ask.select({
          name: "sign-in preset",
          message: "Which sign-in method would you like your users to see first?",
          initialValue: answers.preset,
          options: SETUP_PRESETS.map((preset) => {
            return {
              value: preset,
              label: {
                "password-first":
                  "Email and password, with passkeys enabled but not shown at sign-in",
                "passkey-first": "Passkey, with email and password shown as the alternative",
              }[preset],
            };
          }),
        }),
      },
    };
  }
}
