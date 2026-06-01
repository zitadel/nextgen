import { confirm } from "@clack/prompts";

import { ZitadelError } from "../../../lib/errors";
import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Detected `<framework>`. Proceed?" — the wizard's first question. Accepting
 * leaves answers unchanged; declining throws `E_UNSUPPORTED_PROJECT_SHAPE`
 * (the user should re-run with an explicit `--framework`).
 */
export class FrameworkConfirmPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    const ack = await confirm({
      message: `Detected ${ctx.framework.id}. Proceed?`,
      initialValue: true,
    });
    bail(ack);
    if (ack === false) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        "Setup cancelled — framework declined",
        { hint: `Re-run with --framework ${ctx.framework.id} when ready.` },
      );
    }
    return answers;
  }
}
