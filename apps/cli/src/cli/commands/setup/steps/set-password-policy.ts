import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

import type { Fact, PromptContext, SetupServices, SetupAnswers } from "@/cli/commands/setup/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { WizardStep } from "@/lib/wizard";

/**
 * "Which minimum length should passwords have?" — a choice of 15
 * characters, 8 or none, with 15 preselected and marked recommended. Setup
 * always writes the password policy file; the answer goes into it, and "none"
 * leaves its `config` empty, which enforces nothing.
 *
 * The two lengths are NIST SP 800-63B-4's: at least 15 characters for a
 * password that is the only factor, at least 8 for one that is only ever part
 * of multi-factor sign-in. The developer still decides; the wizard only says
 * which answer is the safe one, and any other length goes into
 * `.zitadel/policies/` or `--password-min-length`. A run with nobody to ask
 * gets the same 15 unless the flag says otherwise (`PasswordPolicy.initial`).
 *
 * `--password-min-length` is authoritative and skips the question.
 */
export class SetPasswordPolicy extends WizardStep<
  "passwordPolicy",
  Fact<"answers">,
  QuestionNeeds,
  SetupServices
> {
  readonly key = "passwordPolicy";

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
   * Not "(recommended)": the prompt puts the hint in parentheses too.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.passwordMinLengthFromFlag) {
      return answers;
    }
    const passwordMinLength = await ctx.ask.select({
      name: "minimum password length",
      message: "Which minimum length should passwords have? You can change it later.",
      initialValue: RECOMMENDED_PASSWORD_MIN_LENGTH,
      options: [
        {
          value: RECOMMENDED_PASSWORD_MIN_LENGTH,
          label: `${RECOMMENDED_PASSWORD_MIN_LENGTH} characters — recommended`,
          hint: "NIST minimum for password-only sign-in",
        },
        {
          value: 8,
          label: "8 characters",
          hint: "NIST minimum with a second factor",
        },
        {
          value: null,
          label: "No minimum",
        },
      ],
    });
    return {
      ...answers,
      passwordMinLength,
    };
  }
}

type QuestionNeeds = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;
