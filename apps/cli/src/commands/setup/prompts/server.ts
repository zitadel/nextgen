import { select, spinner, text } from "@clack/prompts";

import { detectHealthyLocalServer } from "../../../lib/local-server/runtime";
import { DEFAULT_SERVER } from "../../../lib/server";
import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/** Sentinel returned by the choice select when the user picks "Custom URL". */
const CUSTOM = "__custom__";

/**
 * "Which server should `zitadel.json` point to?" — Zitadel Cloud, the managed
 * local server we detected, or a custom URL.
 *
 * Before asking, it looks for a healthy local Zitadel server the same way the
 * rest of the CLI does (`detectHealthyLocalServer`: the runtime metadata that
 * `zitadel start` wrote to `.zitadel/local/runtime.json`, falling back to a
 * `/healthz` probe on the default localhost port). A detected server becomes
 * an extra option in the choice list *and* the preselected answer — a user
 * who just ran `zitadel start` almost certainly wants it, and `start`'s own
 * next-step hint says `setup --server local`. Picking it writes the URL
 * directly to `answers.server`; picking "Custom URL" still asks for a
 * validated URL exactly as before.
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
    const detected = await detectLocalServer(ctx.cwd);

    const choice = await select({
      message: "Which server should zitadel.json point to?",
      options: [
        {
          value: DEFAULT_SERVER,
          label: "Zitadel Cloud (api.zitadel.cloud)",
          hint: "recommended for real projects",
        },
        ...(detected
          ? [
              {
                value: detected,
                label: `Local Zitadel server (${detected})`,
                hint: "detected — started with zitadel start",
              },
            ]
          : []),
        { value: CUSTOM, label: "Custom URL (self-hosted)" },
      ],
      initialValue: detected ?? answers.server ?? DEFAULT_SERVER,
    });
    bail(choice);
    if (choice !== CUSTOM) {
      return { ...answers, server: choice as string };
    }
    const custom = await text({
      message: "Server URL",
      placeholder: "https://zitadel.internal",
      validate: (value) => {
        try {
          new URL(value ?? "");
          return;
        } catch {
          return "Must be a valid URL";
        }
      },
    });
    bail(custom);
    return { ...answers, server: custom as string };
  }
}

/**
 * Wraps {@link detectHealthyLocalServer} in a spinner: the unhealthy paths
 * block on up to two 1.5s `/healthz` probes, long enough that the wizard
 * should say what it is doing.
 */
async function detectLocalServer(cwd: string): Promise<string | undefined> {
  const s = spinner();
  s.start("Checking for a local Zitadel server");
  const detected = await detectHealthyLocalServer(cwd);
  s.stop(
    detected
      ? `Found local Zitadel server at ${detected}.`
      : "No local Zitadel server detected.",
  );
  return detected;
}
