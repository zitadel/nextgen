import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

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
  QuestionNeeds
> {
  readonly key = "passwordPolicy";

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
   * Ask which minimum length passwords have.
   *
   * @remarks
   * The recommended label is not suffixed "(recommended)": the prompt puts the hint in
   * parentheses too.
   *
   * @param answers - The answers so far.
   * @param ctx - What the question needs to ask.
   * @returns The answers, with the minimum length settled.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.passwordMinLengthFromFlag) {
      return answers;
    }
    return {
      ...answers,
      passwordMinLength: await ctx.ask.select({
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
      }),
    };
  }
}
