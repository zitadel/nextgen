import { ZitadelError } from "@/lib/errors";

import type { Fact, PromptContext, SetupServices, SetupAnswers } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

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
  QuestionNeeds,
  SetupServices
> {
  readonly key = "frameworkConfirm";

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

  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.frameworkChosen) {
      return answers;
    }
    const ack = await ctx.ask.yesNo({
      name: "confirm the framework",
      message: `Would you like to set up Zitadel in this ${ctx.framework.displayName} app?`,
      initialValue: true,
    });
    if (ack === false) {
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

type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;
