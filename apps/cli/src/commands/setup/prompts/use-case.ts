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
    // Lead with the field set (what the axis actually controls); the audience
    // is the flavor. A consumer app that wants email-only should still read
    // "minimal" as the right pick.
    const labels: Record<SetupUseCase, string> = {
      minimal: "Email only — just me or a small group",
      consumer: "Email, given and family name — consumer apps",
      business: "Email, given and family name, company — business apps",
    };
    const value = await select({
      message: "Who will sign in to your app?",
      initialValue: answers.useCase,
      options: SETUP_USE_CASES.map((useCase) => ({ value: useCase, label: labels[useCase] })),
    });
    bail(value);
    return { ...answers, useCase: value as SetupUseCase };
  }
}
