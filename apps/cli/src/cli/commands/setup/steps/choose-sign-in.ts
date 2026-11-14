import { SETUP_PRESETS } from "@zitadel/config/defaults";

import type { Fact, PromptContext, SetupServices, SetupAnswers } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/**
 * "Which sign-in method would you like your users to see first?" — picks the
 * schema+flow preset the scaffold starts from, before any `.zitadel/` file is
 * written. `--preset` is authoritative; non-interactive runs keep the
 * password-first default seeded by the command.
 */
export class ChooseSignIn extends WizardStep<
  "signInPreset",
  Fact<"answers">,
  QuestionNeeds,
  SetupServices
> {
  readonly key = "signInPreset";

  /**
   * Ask the question, or leave the answers as they are when nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @param services - What the command provides.
   * @returns The answers, with this question's settled.
   */
  async run(needs: QuestionNeeds, services: SetupServices): Promise<Fact<"answers">> {
    const { app, flags, orca, scaffoldedFramework } = needs;
    if (services.nonInteractive || services.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: await this.ask(needs.answers, {
        ask: services.ask,
        note: (title, lines) => {
          services.ui.note(title, lines);
        },
        say: (text) => {
          services.ui.say(text);
        },
        spinner: (label, options) => {
          return services.ui.spinner(label, options);
        },
        framework: {
          id: app.framework,
          displayName: orca.displayName(app.framework),
        },
        suggest: services.suggest,
        cwd: services.cwd,
        frameworkChosen: scaffoldedFramework || flags.framework !== undefined,
        serverFlag: services.serverFlag,
        devPortFromFlag: flags.devPort !== undefined,
        presetFromFlag: flags.preset !== undefined,
        useCaseFromFlag: flags.useCase !== undefined,
        ssoFromFlag: flags.sso !== undefined,
        passwordMinLengthFromFlag: flags.passwordMinLength !== undefined,
        developmentBuild: isDevelopmentBuild(),
      }),
    };
  }

  /**
   * Each label says what users see first and what is secondary, because both presets enable
   * password and passkey in the schema: the choice is only which one the login flow shows first.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.presetFromFlag) {
      return answers;
    }
    const preset = await ctx.ask.select({
      name: "sign-in preset",
      message: "Which sign-in method would you like your users to see first?",
      initialValue: answers.preset,
      options: SETUP_PRESETS.map((preset) => {
        return {
          value: preset,
          label: {
            "password-first": "Email and password, with passkeys enabled but not shown at sign-in",
            "passkey-first": "Passkey, with email and password shown as the alternative",
          }[preset],
        };
      }),
    });
    return {
      ...answers,
      preset,
    };
  }
}

type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;
