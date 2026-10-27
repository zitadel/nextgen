import { ZitadelError } from "../../../lib/errors";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Would you like to set up Zitadel in this `<framework>` app?" — the
 * wizard's first question in an app setup found, asked before anything in it
 * changes. Accepting leaves answers unchanged.
 *
 * Declining throws `E_UNSUPPORTED_PROJECT_SHAPE`, and the hint points at the
 * one way to a different app: running setup in its directory. `--framework`
 * is no way out, because setup refuses a framework other than the one it
 * detects here (`E_CONFLICT`), so the hint does not offer it.
 *
 * Skipped when the developer already named the framework, by picking it to
 * scaffold or with `--framework`: detection then only read back their own
 * answer.
 */
export class FrameworkConfirmPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.frameworkChosen) {
      return answers;
    }
    const ack = await ctx.input({
      kind: "confirm",
      name: "confirm the framework",
      message: `Would you like to set up Zitadel in this ${ctx.framework.displayName} app?`,
      initialValue: true,
    });
    if (ack === false) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Setup stopped before changing this ${ctx.framework.displayName} app`,
        {
          hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
        },
      );
    }
    return answers;
  }
}
