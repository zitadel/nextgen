import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "ask" | "dryRun" | "nonInteractive">;

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
export class SetPasswordPolicy extends WizardStep<"passwordPolicy", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "passwordPolicy";

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
   * Ask which minimum length passwords have, or leave the answers as they are when nothing can be
   * asked.
   *
   * @remarks
   * The recommended label is not suffixed "(recommended)": the prompt puts the hint in
   * parentheses too.
   *
   * @param needs - The flags and the answers so far.
   * @returns The answers, with this question's settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { answers, flags } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun || flags.passwordMinLength !== undefined) {
      return {
        answers,
      };
    }
    return {
      answers: {
        ...answers,
        passwordMinLength: await this.deps.ask.select({
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
      },
    };
  }
}
