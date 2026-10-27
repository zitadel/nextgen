import type { Parsed } from "@zitadel/config/idp";

import { LocalServer } from "../../../lib/local-server/server";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Port 3000 is in use. Which port should your app run on?" — asked only when
 * something already holds the detected port. A free one is nearly always the
 * answer, and a question whose answer is Enter is one more step for nothing:
 * the summary shows the port, and `setup --dev-port` moves a set-up app later.
 * A taken one is worth the question, because setup pins the dev script to the
 * port and the dev server then fails to start on it.
 *
 * The taken port stays the suggestion: what holds it may be this app's own dev
 * server, and then it is the right answer. The validated answer becomes the
 * issuer URL (`http://localhost:<port>`) via `issuerFromPort`.
 */
export class DevPortPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    // `--dev-port <n>` is authoritative: skip the prompt so an interactive
    // answer can't override the explicit flag (the base command already folded
    // it into answers.devPort).
    if (ctx.devPortFromFlag || (await LocalServer.isPortFree(answers.devPort))) {
      return answers;
    }
    const devPort = await ctx.input({
      kind: "text",
      name: "dev server port",
      message: `Port ${answers.devPort} is in use. Which port should your app run on?`,
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
