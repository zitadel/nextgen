import { parsePasswordMinLength } from "../../../lib/policies";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Set a minimum password length?" — optional. Setup always writes the
 * password policy file, with an empty `config` that enforces nothing; this
 * puts a minimum into it when the developer gives one. Nothing is
 * preselected: the placeholder shows an example, and an empty answer or 0
 * sets nothing. `--password-min-length` is authoritative and skips the question.
 */
export class PasswordPolicyPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.passwordMinLengthFromFlag) {
      return answers;
    }
    const passwordMinLength = await ctx.input({
      kind: "text",
      name: "minimum password length",
      message:
        "Set a minimum password length? Leave empty or enter 0 for none; you can change it in .zitadel/policies/ later.",
      placeholder: "e.g. 15",
      parse: parsePasswordMinLength,
    });
    return { ...answers, passwordMinLength };
  }
}
