import type { Parsed } from "@zitadel/config/idp";

import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Where will your app run during development?" — defaults to the detected
 * port. It takes a port or the address it is served at; the validated answer
 * becomes the issuer URL (`http://localhost:<port>`) via `issuerFromPort`.
 */
const ADDRESS_PROBLEM = "Enter a port such as 3000, or an address such as http://localhost:3000.";

/** A port, or a `http://localhost:<port>` address, as the port it names. */
export function parseDevAddress(value: string): Parsed<number> {
  const text = value.trim();
  const port = /^\d+$/.test(text)
    ? Number.parseInt(text, 10)
    : Number.parseInt(/^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?$/.exec(text)?.[1] ?? "", 10);
  return Number.isFinite(port) && port > 0 && port < 65536
    ? { ok: true, value: port }
    : { ok: false, problem: ADDRESS_PROBLEM };
}

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
      message: "Where will your app run during development?",
      placeholder: `http://localhost:${answers.devPort}`,
      initialValue: `http://localhost:${answers.devPort}`,
      parse: parseDevAddress,
    });
    return { ...answers, devPort };
  }
}
