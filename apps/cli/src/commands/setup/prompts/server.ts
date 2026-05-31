import { select, spinner, text } from "@clack/prompts";

import { DEFAULT_SERVER } from "../../../lib/api/resolve-server";
import { listListeningPorts, probeUrls } from "../../../lib/prober";
import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/** Sentinel returned by the choice select when the user picks "Custom URL". */
const CUSTOM = "__custom__";

/** Per-probe timeout for the localhost OIDC scan — generous enough for a TLS handshake on a busy laptop. */
const OIDC_PROBE_TIMEOUT_MS = 300;

/**
 * "Which server should `zitadel.json` point to?" — Zitadel Cloud, a localhost
 * OIDC server we discovered, or a custom URL.
 *
 * Before asking, it scans the loopback for listening ports (via the generic
 * `lib/prober`) and `GET`s `/.well-known/openid-configuration` on each. Every
 * 2xx response with a string `issuer` becomes an extra option in the choice
 * list. Picking a discovered URL writes it directly to `answers.server` and
 * skips the follow-up text prompt. Picking "Custom URL" still asks for a
 * validated URL exactly as before.
 */
export class ServerPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, _ctx: PromptContext): Promise<SetupAnswers> {
    const discovered = await discoverLocalOidc();

    const choice = await select({
      message: "Which server should zitadel.json point to?",
      options: [
        {
          value: DEFAULT_SERVER,
          label: "Zitadel Cloud (api.zitadel.cloud)",
          hint: "recommended for real projects",
        },
        ...discovered.map((server) => ({
          value: server,
          label: server,
          hint: "detected — OIDC",
        })),
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

/**
 * Returns the loopback origins (`http://localhost:<port>`) whose
 * `/.well-known/openid-configuration` endpoint responds with a valid OIDC
 * discovery document. Sniffs purely via the generic prober — the only
 * Zitadel-shaped detail here is the OIDC predicate, which is the standard
 * "any OIDC server" contract (no `zitadel`-keyword check), so Keycloak/dex/
 * etc. also surface and the user picks the right one.
 */
async function discoverLocalOidc(): Promise<ReadonlyArray<string>> {
  const s = spinner();
  s.start("Scanning localhost for OIDC servers");
  try {
    const ports = await listListeningPorts();
    if (ports.length === 0) {
      s.stop("No local servers detected.");
      return [];
    }
    const matches = await probeUrls(
      ports.map((port) => `http://localhost:${port}/.well-known/openid-configuration`),
      async (response) => {
        if (!response.ok) {
          return null;
        }
        try {
          const body = (await response.json()) as { issuer?: unknown };
          return typeof body.issuer === "string" ? body.issuer : null;
        } catch {
          return null;
        }
      },
      { timeoutMs: OIDC_PROBE_TIMEOUT_MS },
    );
    // Map each matched discovery URL back to its bare origin — that's what
    // ends up in `zitadel.json`'s `server` field.
    const origins = matches.map((match) => new URL(match.url).origin);
    s.stop(
      origins.length === 0
        ? "No local OIDC servers found."
        : `Found ${origins.length} local OIDC server${origins.length === 1 ? "" : "s"}.`,
    );
    return origins;
  } catch (error) {
    s.stop("Discovery skipped.");
    throw error;
  }
}
