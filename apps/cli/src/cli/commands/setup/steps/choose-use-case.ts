import { SETUP_USE_CASES } from "@zitadel/config/defaults";

import type { Fact, PromptContext, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
>;

/**
 * "Which fields should registration collect?" — picks the use case,
 * which owns the schema field set the scaffold collects. Orthogonal to the
 * sign-in preset, so this asks first: what a user *is* before *how* they sign
 * in. `--use-case` is authoritative; non-interactive runs keep the minimal
 * default seeded by the command.
 */
export class ChooseUseCase extends WizardStep<"useCase", Fact<"answers">, QuestionNeeds> {
  readonly key = "useCase";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask the question, or leave the answers as they are when nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @param this.deps - What the command provides.
   * @returns The answers, with this question's settled.
   */
  async run(needs: QuestionNeeds): Promise<Fact<"answers">> {
    const { app, flags, orca, scaffoldedFramework } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: await this.ask(needs.answers, {
        ask: this.deps.ask,
        note: (title, lines) => {
          this.deps.ui.note(title, lines);
        },
        say: (text) => {
          this.deps.ui.say(text);
        },
        spinner: (label, options) => {
          return this.deps.ui.spinner(label, options);
        },
        framework: {
          id: app.framework,
          displayName: orca.displayName(app.framework),
        },
        suggest: this.deps.suggest,
        cwd: this.deps.cwd,
        frameworkChosen: scaffoldedFramework || flags.framework !== undefined,
        serverFlag: this.deps.serverFlag,
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
   * Ask which fields registration collects.
   *
   * @remarks
   * The labels are the field sets themselves, so all three stay comparable whichever option is
   * highlighted (a hint shows only for the highlighted one). The internal use-case values are
   * unchanged: the use case is recorded in `zitadel.json`, and `--use-case` still names them. The
   * message notes the fields stay editable after setup — the scaffolded schema/flow are the source
   * of truth — and stays short enough for one line of an 80-column terminal. That every set
   * includes email, the labels already say.
   *
   * @param answers - The answers so far.
   * @param ctx - What the question needs to ask.
   * @returns The answers, with the use case settled.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.useCaseFromFlag) {
      return answers;
    }
    return {
      ...answers,
      useCase: await ctx.ask.select({
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
      }),
    };
  }
}
