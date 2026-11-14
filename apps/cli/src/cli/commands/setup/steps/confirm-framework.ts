import { ZitadelError } from "@/lib/errors";

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
 * "Would you like to set up Zitadel in this `<framework>` app?" — the
 * wizard's first question in an app setup found, asked before anything in it
 * changes. Accepting leaves answers unchanged.
 *
 * Declining throws `E_UNSUPPORTED_PROJECT_SHAPE`, and the hint points at the
 * one way to a different app: running setup in its directory. `--framework`
 * is no way out, because setup refuses a framework other than the one it
 * detects here (`E_CONFLICT`), so the hint does not offer it.
 *
 * Skipped when the developer already named the framework, by picking it to
 * scaffold or with `--framework`: detection then only read back their own
 * answer.
 */
export class ConfirmFramework extends WizardStep<
  "frameworkConfirm",
  Fact<"answers">,
  QuestionNeeds
> {
  readonly key = "frameworkConfirm";

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
   * Ask whether to set up Zitadel in the detected app.
   *
   * @param answers - The answers so far.
   * @param ctx - What the question needs to ask.
   * @returns The answers, unchanged.
   * @throws {@link ZitadelError} When the developer declines.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.frameworkChosen) {
      return answers;
    }
    if (
      (await ctx.ask.yesNo({
        name: "confirm the framework",
        message: `Would you like to set up Zitadel in this ${ctx.framework.displayName} app?`,
        initialValue: true,
      })) === false
    ) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Setup stopped before changing this ${ctx.framework.displayName} app`,
        {
          hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
        },
      );
    }
    return answers;
  }
}
