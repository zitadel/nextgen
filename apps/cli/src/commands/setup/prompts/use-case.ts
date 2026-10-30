import { SETUP_USE_CASES, type SetupUseCase } from "@zitadel/config/defaults";

import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Which fields should registration collect?" — picks the use case,
 * which owns the schema field set the scaffold collects (#448). Orthogonal to
 * the sign-in preset, so this asks first: what a user *is* before *how* they
 * sign in.
 * `--use-case` is authoritative; non-interactive runs keep the minimal
 * default seeded by the command.
 */
export class UseCasePrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.useCaseFromFlag) {
      return answers;
    }
    // The labels are the field sets themselves, so all three stay comparable
    // whichever option is highlighted (a hint shows only for the highlighted
    // one). The internal use-case values are unchanged: the use case is
    // recorded in `zitadel.json`, and `--use-case` still names them. The
    // message notes the fields stay editable after setup — the scaffolded
    // schema/flow are the source of truth — and stays short enough for one
    // line of an 80-column terminal. That every set includes email, the
    // labels already say.
    const labels: Record<SetupUseCase, string> = {
      minimal: "Email only",
      consumer: "Email, first name and last name",
      business: "Email, first name, last name and company name",
    };
    const useCase = await ctx.ask.select({
      name: "use case",
      message: "Which fields should registration collect? You can change them later.",
      initialValue: answers.useCase,
      options: SETUP_USE_CASES.map((useCase) => ({
        value: useCase,
        label: labels[useCase],
      })),
    });
    return { ...answers, useCase };
  }
}
