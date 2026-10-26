import type { Parsed } from "@zitadel/config/idp";

import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Which port should your app run on?" — defaults to the detected port. The validated answer
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
    const devPort = await ctx.input({
      kind: "text",
      name: "dev server port",
      message: `Which port should your app run on? Press Enter to use ${answers.devPort}, or type a different port.`,
      placeholder: String(answers.devPort),
      initialValue: String(answers.devPort),
      parse: (value): Parsed<number> => {
        const port = Number.parseInt(value, 10);
        return Number.isFinite(port) && port > 0 && port < 65536
          ? { ok: true, value: port }
          : { ok: false, problem: "Must be a port number" };
      },
    });
    return { ...answers, devPort };
  }
}
