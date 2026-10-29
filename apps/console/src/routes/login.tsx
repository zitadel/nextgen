import { createFileRoute, redirect } from "@tanstack/react-router";
import { createZitadelClient } from "@zitadel/api/client";

import { apiBase } from "@/api/zitadel";
import { fetchSession, sanitizeNextPath } from "@/auth/session";
import { SignInScreen } from "@/components/sign-in-screen";
import { stringParam } from "@/lib/search-params";
import { getConsoleProjectId, getPublishableKey } from "@/runtime/runtime";

/**
 * Console sign-in screen (Console ADR 0003): the widget on its `login`
 * purpose (`SignInScreen`, which says how the widget is configured).
 *
 * `?next=` carries the router-relative path the `_authed` guard intercepted;
 * it is sanitized against open redirects before the screen joins it with the
 * deployment prefix.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string; handoff?: string } => ({
    next: sanitizeNextPath(stringParam(search.next)),
    handoff: stringParam(search.handoff),
  }),
  beforeLoad: async ({ search }) => {
    // A sign-in link (`/login?handoff=<token>`) printed by the CLI carries a
    // one-time handoff token; trade it for the session cookie before deciding
    // whether to show the widget. Only on a loopback console: the link is a
    // bearer credential for whoever minted it, so honouring it on a deployed
    // console would let a crafted link silently sign a visitor into the
    // link-maker's session. Minting one requires an account on the server that
    // issued it, which for a developer's own local instance is the developer.
    if (search.handoff && isLoopbackConsole()) {
      await exchangeLinkHandoff(search.handoff);
    }
    const session = await fetchSession();
    if (session) {
      // Already signed in — skip the widget. `next` is router-relative by
      // construction; the cast widens the typed `to` union for the dynamic
      // value (the router resolves plain paths at runtime).
      throw redirect({ to: (search.next ?? "/") as "/" });
    }
  },
  component: LoginScreen,
});

/**
 * Whether this console is served from the developer's own machine, which is
 * where `zitadel start` prints sign-in links. `localhost`, the `127.0.0.0/8`
 * block, and `[::1]` (how WHATWG URLs spell IPv6 loopback).
 */
function isLoopbackConsole(): boolean {
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Exchanges a sign-in link's handoff token for the `__nextgen_session`
 * cookie, the same `POST /sessions/exchange` the widget calls at the end of a
 * login flow. Failures fall through to the normal sign-in widget.
 */
async function exchangeLinkHandoff(handoffToken: string): Promise<void> {
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

function LoginScreen() {
  const { next } = Route.useSearch();
  return <SignInScreen purpose="login" heading="Sign in to the Zitadel console" next={next} />;
}
