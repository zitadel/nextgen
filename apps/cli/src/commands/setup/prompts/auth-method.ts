import { select } from "@clack/prompts";

import type { AuthMethod } from "../../../lib/flows";
import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

const CHOICES: ReadonlyArray<{ value: AuthMethod; label: string; hint?: string }> = [
  { value: "passkey", label: "passkey", hint: "recommended" },
  { value: "password", label: "password" },
];

/**
 * "Auth method" — picks `passkey` or `password`. Skipped when `--auth-method`
 * has already filled `answers.authMethod` with a valid value.
 */
export class AuthMethodPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, _ctx: PromptContext): Promise<SetupAnswers> {
    if (answers.authMethod !== undefined) {
      return answers;
    }
    const value = await select<AuthMethod>({
      message: "Auth method",
      options: CHOICES.map(({ value, label, hint }) => ({ value, label, hint })),
      initialValue: "passkey",
    });
    bail(value);
    return { ...answers, authMethod: value };
  }
}
