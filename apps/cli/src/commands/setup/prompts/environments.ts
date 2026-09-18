import { confirm, select, text } from "@clack/prompts";

import { DEFAULT_SERVER } from "../../../lib/server";
import { bail } from "./cancel";
import type { EnvironmentAnswer, PromptContext, SetupAnswers, SetupPrompt } from "./types";

const SAME_AS_LOCAL = "__local__";
const CUSTOM = "__custom__";
const LATER = "__later__";

/** Vercel preview deployments: `<app>-<branch>-<team>.vercel.app`. */
export const DEFAULT_PREVIEW_ORIGIN_PATTERN = "https://*.vercel.app";

/**
 * Where the app runs beyond the developer's machine, written to
 * `zitadel.json` as the `environments` map.
 *
 * The usual shape: `development` talks to the local server (the one chosen
 * just before this prompt) on its own project, so local testing never
 * touches real users. `production` talks to Zitadel Cloud or a self-hosted
 * server on a project of its own, created by setup. `preview` deployments
 * share production's project — they exist to try a configuration release
 * against real-shaped data — and only differ in the origin they are served
 * from, which is a per-deployment hostname on hosting platforms, hence a
 * wildcard pattern.
 *
 * Production can be deferred (`later`): the map then holds `development`
 * only and the entry is added by hand when the production server is known.
 */
export class EnvironmentsPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    const development: EnvironmentAnswer = {
      name: "development",
      server: answers.server,
      isolated: false,
    };

    const production = await askProduction(answers.server, ctx);
    if (!production) {
      return { ...answers, environments: [development] };
    }
    const environments: EnvironmentAnswer[] = [development, production];

    const preview = await askPreview();
    if (preview) {
      environments.push(preview);
    }
    return { ...answers, environments };
  }
}

async function askProduction(
  localServer: string,
  ctx: PromptContext,
): Promise<EnvironmentAnswer | undefined> {
  const serverChoice = await select({
    message: "Where does production run? (Zitadel server)",
    options: [
      {
        value: DEFAULT_SERVER,
        label: "Zitadel Cloud (api.zitadel.cloud)",
        hint: "recommended",
      },
      { value: CUSTOM, label: "Self-hosted server (URL)" },
      {
        value: SAME_AS_LOCAL,
        label: `Same server as development (${localServer})`,
        hint: "own project, so production data stays apart from local testing",
      },
      { value: LATER, label: "Decide later", hint: "only development is configured now" },
    ],
    initialValue: DEFAULT_SERVER,
  });
  bail(serverChoice);
  if (serverChoice === LATER) {
    return undefined;
  }
  let server = localServer;
  if (serverChoice === CUSTOM) {
    const custom = await text({
      message: "Production server URL",
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
  } else if (serverChoice !== SAME_AS_LOCAL) {
    server = serverChoice as string;
  }

  const origin = await text({
    message: "Where is the production app served from? (origin, leave empty to add later)",
    placeholder: "https://app.example.com",
    validate: (value) => (value ? validateOriginPattern(value) : undefined),
  });
  bail(origin);
  const origins = String(origin ?? "").trim() === "" ? [] : [String(origin).trim()];
  void ctx;
  return { name: "production", server, isolated: true, origins };
}

async function askPreview(): Promise<EnvironmentAnswer | undefined> {
  const wanted = await confirm({
    message:
      "Use preview environments? Each branch or pull request gets its own configuration on production's project (same users, same data).",
    initialValue: true,
  });
  bail(wanted);
  if (!wanted) {
    return undefined;
  }
  const pattern = await text({
    message: "Where are preview deployments served from? (origin pattern, * matches one host label)",
    placeholder: DEFAULT_PREVIEW_ORIGIN_PATTERN,
    initialValue: DEFAULT_PREVIEW_ORIGIN_PATTERN,
    validate: validateOriginPattern,
  });
  bail(pattern);
  const origins = String(pattern).trim() === "" ? [] : [String(pattern).trim()];
  return {
    name: "preview",
    server: "",
    isolated: false,
    sharesProjectOf: "production",
    origins,
  };
}

/**
 * Mirrors the server's origin-pattern rule: `scheme://host[:port]` where the
 * host may start with `*.` to cover one label.
 */
export function validateOriginPattern(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim().toLowerCase();
  if (!/^https?:\/\//.test(raw)) return "Must start with http:// or https://";
  const host = raw.replace(/^https?:\/\//, "");
  if (host === "" || /[/?#@ ]/.test(host)) return "Must be scheme://host[:port], no path";
  if (host.includes("*") && !/^\*\.[^*.][^*]*$/.test(host)) {
    return "A wildcard must be the whole leftmost label, like https://*.vercel.app";
  }
  return undefined;
}
