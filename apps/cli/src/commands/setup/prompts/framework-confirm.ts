import { ZitadelError } from "../../../lib/errors";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Detected `<framework>`. Proceed?" — the wizard's first question. Accepting
 * leaves answers unchanged; declining throws `E_UNSUPPORTED_PROJECT_SHAPE`
 * (the user should re-run with an explicit `--framework`). Skipped when the
 * developer already named the framework, by picking it to scaffold or with
 * `--framework`: detection then only read back their own answer.
 */
export class FrameworkConfirmPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.frameworkChosen) {
      return answers;
    }
    const ack = await ctx.input({
      kind: "confirm",
      name: "confirm the framework",
      message: `Detected ${ctx.framework.id}. Proceed?`,
      initialValue: true,
    });
    if (ack === false) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        "Setup stopped — the detected framework was declined",
        { hint: `Re-run with --framework ${ctx.framework.id} when ready.` },
      );
    }
    return answers;
  }
}
