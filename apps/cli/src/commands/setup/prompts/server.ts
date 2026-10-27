import type { Parsed } from "@zitadel/config/idp";

import { LocalServer } from "../../../lib/local-server/server";
import { DEFAULT_SERVER } from "../../../lib/server";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/** Sentinel returned by the choice select when the user picks "Custom URL". */
const CUSTOM = "__custom__";
/** The value of the disabled local option, which can never be picked. */
const LOCAL_NOT_RUNNING = "__local_not_running__";

/**
 * "Which Zitadel server should your app use?" — Zitadel Cloud, the managed
 * local server, or a custom URL. Setup creates the project there, so the
 * question names the server and not the file that records it.
 *
 * Before asking, it looks for a healthy local Zitadel server the same way the
 * rest of the CLI does (`LocalServer.detectUrl`: the server the runtime
 * metadata `zitadel start` wrote to `.zitadel/local/runtime.json` names, when
 * its own process answers a `/readyz` probe). A detected server becomes an
 * option *and* the preselected answer — a user who just ran `zitadel start`
 * almost certainly wants it, and `start`'s own next-step hint says
 * `setup --server local`. Without one, the local option is still listed,
 * disabled, saying how to get it, so the choice is visible before it is
 * available. Picking a server writes its URL directly to `answers.server`;
 * picking "Custom URL" still asks for a validated URL.
 */
export class ServerPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    // `--server <url>` overrides the wizard entirely. The base command
    // already validated and resolved the URL into `answers.server`;
    // asking the user to re-pick from a fixed select list when their
    // flag isn't in the list (Cloud / detected / Custom) was a bug —
    // clack would silently default back to Cloud.
    if (ctx.serverFlag) {
      return answers;
    }
    const detected = await detectLocalServer(ctx);

    const choice = await ctx.ask.select({
      name: "server",
      message: "Which Zitadel server should your app use?",
      options: [
        {
          value: DEFAULT_SERVER,
          label: `Zitadel Cloud (${new URL(DEFAULT_SERVER).host})`,
        },
        detected
          ? {
              value: detected,
              label: `Local server (${detected})`,
              hint: "started with zitadel start",
            }
          : {
              value: LOCAL_NOT_RUNNING,
              label: "Local server",
              hint: "not running — run zitadel start first",
              disabled: true,
            },
        { value: CUSTOM, label: "Custom URL (self-hosted)" },
      ],
      initialValue: detected ?? answers.server ?? DEFAULT_SERVER,
    });
    if (choice !== CUSTOM) {
      return { ...answers, server: choice };
    }
    const custom = await ctx.ask.text({
      name: "server URL",
      message: "What is the URL of your Zitadel server?",
      placeholder: "https://zitadel.internal",
      parse: (value): Parsed<string> => {
        try {
          new URL(value);
          return { ok: true, value };
        } catch {
          return { ok: false, problem: "Must be a valid URL" };
        }
      },
    });
    return { ...answers, server: custom };
  }
}

/**
 * Wraps {@link LocalServer.detectUrl} in a spinner: the `/readyz` probe of a
 * server that does not answer takes up to 1.5s, long enough that the wizard
 * should say what it is doing. The spinner then clears instead of leaving a
 * line behind, because the options it decides already say what it found, and
 * it draws no guide line of its own, which clearing would leave behind.
 */
async function detectLocalServer(ctx: PromptContext): Promise<string | undefined> {
  const probing = ctx.spinner("Checking for a local Zitadel server", { guide: false });
  const detected = await LocalServer.detectUrl(ctx.cwd);
  probing.clear();
  return detected;
}
