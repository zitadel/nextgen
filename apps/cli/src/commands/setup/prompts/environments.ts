import { multiselect, select, text } from "@clack/prompts";

import { DEFAULT_SERVER } from "../../../lib/server";
import { bail } from "./cancel";
import type { EnvironmentAnswer, PromptContext, SetupAnswers, SetupPrompt } from "./types";

const SAME_SERVER = "__same__";
const CUSTOM = "__custom__";

/**
 * "Which environments does this app run in?" — maps each frontend
 * environment to a project on a server, written to `zitadel.json`.
 *
 * `development` is always present and points at the setup server and the
 * project setup creates. `preview` and `production` are offered on top;
 * each picks a server and whether it shares the project (same users as
 * development, the recommended shape) or gets an isolated project of its own
 * (an empty user base, for destructive testing). Previews on the server are
 * created later by `zitadel preview`; nothing is provisioned here beyond the
 * isolated projects, which setup creates right after the main one.
 */
export class EnvironmentsPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, _ctx: PromptContext): Promise<SetupAnswers> {
    const picked = await multiselect({
      message: "Which environments does this app run in?",
      options: [
        {
          value: "development",
          label: "development",
          hint: `local app, ${answers.server}`,
        },
        {
          value: "preview",
          label: "preview",
          hint: "per-branch / pull-request deployments (Vercel previews and the like)",
        },
        { value: "production", label: "production", hint: "the real thing" },
      ],
      initialValues: ["development", "preview", "production"],
      required: true,
    });
    bail(picked);
    const names = (picked as string[]).filter((name) => name !== "development");

    const environments: EnvironmentAnswer[] = [
      { name: "development", server: answers.server, isolated: false },
    ];
    for (const name of names) {
      environments.push(await askEnvironment(name, answers.server));
    }
    return { ...answers, environments };
  }
}

async function askEnvironment(name: string, setupServer: string): Promise<EnvironmentAnswer> {
  const serverChoice = await select({
    message: `Which server does ${name} use?`,
    options: [
      { value: SAME_SERVER, label: `Same as development (${setupServer})` },
      ...(setupServer === DEFAULT_SERVER
        ? []
        : [{ value: DEFAULT_SERVER, label: "Zitadel Cloud (api.zitadel.cloud)" }]),
      { value: CUSTOM, label: "Custom URL (self-hosted)" },
    ],
    initialValue: SAME_SERVER,
  });
  bail(serverChoice);
  let server = setupServer;
  if (serverChoice === CUSTOM) {
    const custom = await text({
      message: `Server URL for ${name}`,
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
    server = custom as string;
  } else if (serverChoice !== SAME_SERVER) {
    server = serverChoice as string;
  }

  const projectChoice = await select({
    message: `Should ${name} share users with development?`,
    options: [
      {
        value: "shared",
        label: "Shared — same project, same users",
        hint: "recommended: previews test against real-shaped data",
      },
      {
        value: "isolated",
        label: "Isolated — its own project, empty user base",
        hint: "good for destructive tests; setup creates the project now",
      },
    ],
    initialValue: "shared",
  });
  bail(projectChoice);
  return { name, server, isolated: projectChoice === "isolated" };
}
