import { select } from "@clack/prompts";

import { SETUP_USE_CASES, type SetupUseCase } from "@zitadel/config/defaults";

import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Who will sign in to your app?" — picks the use case, which owns the
 * schema field set the scaffold collects (#448). Orthogonal to the sign-in
 * preset, so this asks first: what a user *is* before *how* they sign in.
 * `--use-case` is authoritative; non-interactive runs keep the minimal
 * default seeded by the command.
 */
export class UseCasePrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.useCaseFromFlag) {
      return answers;
    }
    // Audience-first labels (the use case is recorded in `zitadel.json` and may
    // inform guidance/status beyond the schema, so it stays generic), with the
    // collected fields as a dimmed per-option hint. The message notes the fields
    // stay editable after setup — the scaffolded schema/flow are the source of
    // truth.
    const options: Record<SetupUseCase, { label: string; hint: string }> = {
      minimal: { label: "Just me or a small group", hint: "collects email" },
      consumer: { label: "Consumers", hint: "collects email, given & family name" },
      business: { label: "Business", hint: "collects email, given & family name, company" },
    };
    const value = await select({
      message: "Who will sign in to your app? Collected fields stay editable after setup.",
      initialValue: answers.useCase,
      options: SETUP_USE_CASES.map((useCase) => ({
        value: useCase,
        label: options[useCase].label,
        hint: options[useCase].hint,
      })),
    });
    bail(value);
    return { ...answers, useCase: value as SetupUseCase };
  }
}
