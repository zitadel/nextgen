import { SETUP_USE_CASES } from "@zitadel/config/defaults";

import type { Fact, PromptContext, SetupServices, SetupAnswers } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/**
 * "Which fields should registration collect?" — picks the use case,
 * which owns the schema field set the scaffold collects. Orthogonal to the
 * sign-in preset, so this asks first: what a user *is* before *how* they sign
 * in. `--use-case` is authoritative; non-interactive runs keep the minimal
 * default seeded by the command.
 */
export class ChooseUseCase extends WizardStep<
  "useCase",
  Fact<"answers">,
  QuestionNeeds,
  SetupServices
> {
  readonly key = "useCase";

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
   * The labels are the field sets themselves, so all three stay comparable whichever option is
   * highlighted (a hint shows only for the highlighted one). The internal use-case values are
   * unchanged: the use case is recorded in `zitadel.json`, and `--use-case` still names them. The
   * message notes the fields stay editable after setup — the scaffolded schema/flow are the source
   * of truth — and stays short enough for one line of an 80-column terminal. That every set
   * includes email, the labels already say.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.useCaseFromFlag) {
      return answers;
    }
    const useCase = await ctx.ask.select({
      name: "use case",
      message: "Which fields should registration collect? You can change them later.",
      initialValue: answers.useCase,
      options: SETUP_USE_CASES.map((useCase) => {
        return {
          value: useCase,
          label: {
            minimal: "Email only",
            consumer: "Email, first name and last name",
            business: "Email, first name, last name and company name",
          }[useCase],
        };
      }),
    });
    return {
      ...answers,
      useCase,
    };
  }
}

type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;
