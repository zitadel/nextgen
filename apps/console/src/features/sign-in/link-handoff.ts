import { createZitadelClient } from "@zitadel/api/client";
import { apiBase } from "@/api/zitadel";
import { getConsoleProjectId, getPublishableKey } from "@/runtime/runtime";

/**
 * Whether this console is served from the developer's own machine, which is
 * where `zitadel start` prints sign-in links. `localhost`, the `127.0.0.0/8`
 * block, and `[::1]` (how WHATWG URLs spell IPv6 loopback).
 */
export function isLoopbackConsole(): boolean {
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Exchanges a sign-in link's handoff token for the session
 * cookie, the same `POST /sessions/exchange` the widget calls at the end of a
 * login flow. Failures fall through to the normal sign-in widget.
 */
export async function exchangeLinkHandoff(handoffToken: string): Promise<void> {
  const projectId = getConsoleProjectId();
  if (!projectId) return;
  // The console's shared client was configured before the runtime document
  // resolved, so it carries no key; this one carries the publishable key the
  // exchange requires.
  await createZitadelClient({ baseUrl: apiBase, token: getPublishableKey() })
    .exchangeHandoff(
      { handoff_token: handoffToken },
      { project_id: projectId },
      { credentials: "include" },
    )
    // Fall through to the widget.
    .catch(() => undefined);
}
