import type { PasswordMinLength } from "../../../lib/policies";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

const RECOMMENDED_MIN_LENGTH = 15;

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
 * keeps the flag's value, or none, and never this recommendation.
 *
 * `--password-min-length` is authoritative and skips the question.
 */
export class PasswordPolicyPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.passwordMinLengthFromFlag) {
      return answers;
    }
    const options: { value: PasswordMinLength; label: string; hint?: string }[] = [
      {
        value: RECOMMENDED_MIN_LENGTH,
        label: `${RECOMMENDED_MIN_LENGTH} characters (recommended)`,
        hint: "NIST minimum for password-only sign-in",
      },
      { value: 8, label: "8 characters", hint: "NIST minimum with a second factor" },
      { value: null, label: "No minimum" },
    ];
    const passwordMinLength = await ctx.input({
      kind: "select",
      name: "minimum password length",
      message: "Which minimum length should passwords have? You can change it later.",
      initialValue: RECOMMENDED_MIN_LENGTH,
      options,
    });
    return { ...answers, passwordMinLength };
  }
}
