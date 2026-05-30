import { select, text } from "@clack/prompts";

import { DEFAULT_SERVER } from "../../../lib/api/resolve-server";
import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/** Sentinel returned by the choice select when the user picks "Custom URL". */
const CUSTOM = "__custom__";

/**
 * "Which server should `zitadel.json` point to?" — Zitadel Cloud or a custom
 * URL. When custom is chosen, immediately follows up with a validated URL
 * prompt. The conditional second question lives here rather than as a separate
 * prompt class because it only makes sense within this choice.
 */
export class ServerPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, _ctx: PromptContext): Promise<SetupAnswers> {
    const choice = await select({
      message: "Which server should zitadel.json point to?",
      options: [
        {
          value: DEFAULT_SERVER,
          label: "Zitadel Cloud (api.zitadel.cloud)",
          hint: "recommended for real projects",
        },
        { value: CUSTOM, label: "Custom URL (self-hosted)" },
      ],
      initialValue: answers.server ?? DEFAULT_SERVER,
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
