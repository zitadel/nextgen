import { createFileRoute, redirect } from "@tanstack/react-router";
import { createZitadelClient } from "@zitadel/api/client";
import { ZitadelLogin } from "@zitadel/sdk-react";

import { apiBase } from "@/api/zitadel";
import { fetchSession, sanitizeNextPath } from "@/auth/session";
import { NoProjectYet, StandaloneScreen } from "@/components/standalone-screen";
import { InlineCode } from "@/components/ui/inline-code";
import { useConsoleProject } from "@/hooks/use-console-project";
import { withBasePath } from "@/lib/base-path";
import { stringParam } from "@/lib/search-params";
import { getConsoleProjectId, getPublishableKey } from "@/runtime/runtime";
import { useTheme } from "@/theme";

/**
 * Console sign-in screen (Console ADR 0003).
 *
 * Renders the embedded `<zitadel-login>` widget via `@zitadel/sdk-react`,
 * passing a per-element `project` **handle** built from the runtime-discovered
 * project id (Console ADR 0004 §3: the runtime document, in development as in
 * production). The handle — not discrete `projectId`/`proxyPath` props — is
 * required here: the widget's config precedence is element `project`
 * property → global `configureZitadel()` → declarative attributes
 * (`resolve-api.ts`), and the console's app-wide `configureZitadel()` call
 * (which binds the API client's base URL at import time) carries an empty
 * project id, so attribute-level config would lose to that global and the
 * widget would refuse to start a flow. The widget drives the flow API at
 * the same-origin API base, and on a terminal step exchanges its
 * `handoff_token` for the `__nextgen_session` HttpOnly cookie before
 * navigating to `postSignInUrl` — a full-document navigation, so the app
 * reboots with the cookie in place.
 *
 * `?next=` carries the router-relative path the `_authed` guard intercepted;
 * it is sanitized against open redirects and re-joined with the Vite
 * `BASE_URL` so the widget's document-level navigation lands inside the
 * deployed prefix (`/ui/console` in production, `/` in dev).
 *
 * The widget resolves its own colour mode (element `theme` → tenant branding
 * → dark) and, in the widget variant, paints no surface of its own. A page
 * that fixes its background — as this one does with `bg-background` — must
 * therefore declare the mode on the element, or the widget's text lands on a
 * surface it wasn't coloured for. We pass the console's *resolved* theme so
 * the sign-in screen follows the same preference as the rest of the console.
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
  const { resolved: theme } = useTheme();
  const postSignInUrl = withBasePath(next ?? "/") || "/";

  // With the runtime-discovered publishable key the widget sends the
  // public-plane bearer itself, so the handoff exchange needs no server-side
  // secret injection.
  const project = useConsoleProject();

  return (
    <StandaloneScreen heading="Sign in to the Zitadel console">
      {project ? (
        <ZitadelLogin
          project={project}
          purpose="login"
          theme={theme}
          postSignInUrl={postSignInUrl}
        />
      ) : (
        <NoProjectSetupHint />
      )}
    </StandaloneScreen>
  );
}

/**
 * Rendered while the deployment has no project. Under Console ADR 0004 §2's
 * transitional cutover rule, the server still discovers the first-created or
 * explicitly pinned project until a human-usable seed transport replaces that
 * fallback. Refreshing after `zitadel setup` picks the new project up via the
 * runtime document.
 */
function NoProjectSetupHint() {
  return (
    <NoProjectYet>
      This deployment has no project to sign in to. Create one from your application with{" "}
      <InlineCode>npx @zitadel/cli setup</InlineCode> — the first project becomes the
      console&apos;s default. Then refresh this page.
    </NoProjectYet>
  );
}
