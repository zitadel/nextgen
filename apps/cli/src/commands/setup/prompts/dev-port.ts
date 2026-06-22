import { text } from "@clack/prompts";

import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Dev server port" — defaults to the detected port. The validated answer
 * becomes the issuer URL (`http://localhost:<port>`) via `issuerFromPort`.
 */
export class DevPortPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    // `--dev-port <n>` is authoritative: skip the prompt so an interactive
    // answer can't override the explicit flag (the base command already folded
    // it into answers.devPort).
    if (ctx.devPortFromFlag) {
      return answers;
    }
    const value = await text({
      message: "Dev server port",
      placeholder: String(answers.devPort),
      initialValue: String(answers.devPort),
      validate: (input) => {
        const num = Number.parseInt(input ?? "", 10);
        return Number.isFinite(num) && num > 0 && num < 65536
          ? undefined
          : "Must be a port number";
      },
    });
    bail(value);
    return { ...answers, devPort: Number.parseInt(String(value), 10) };
  }
}
