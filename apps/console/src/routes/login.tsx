import { createFileRoute, redirect } from "@tanstack/react-router";
import { ZitadelLogin, type ZitadelProject } from "@zitadel/sdk-react";
import { useMemo } from "react";

import { apiBase } from "../api/zitadel";
import { fetchSession, sanitizeNextPath } from "../auth/session";
import { ZitadelMark } from "../components/app-shell/icons";
import { getConsoleProjectId, getPublishableKey } from "../runtime/runtime";
import { useTheme } from "../theme";

/**
 * Console sign-in screen (Console ADR 0003).
 *
 * Renders the embedded `<zitadel-login>` widget via `@zitadel/sdk-react`,
 * passing a per-element `project` **handle** built from the runtime-discovered
 * project id (Console ADR 0004 §3: env override in dev, runtime document
 * otherwise). The handle — not discrete `projectId`/`proxyPath` props — is
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
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: sanitizeNextPath(typeof search.next === "string" ? search.next : undefined),
  }),
  beforeLoad: async ({ search }) => {
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

function LoginScreen() {
  const { next } = Route.useSearch();
  const { resolved: theme } = useTheme();
  const projectId = getConsoleProjectId();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const postSignInUrl = `${base}${next ?? "/"}` || "/";

  // Stable per config tuple: a fresh object every render would re-set the
  // element property and miss the SDK's per-handle client cache. The
  // runtime-discovered publishable key (root ADR 036) makes the widget send
  // the public-plane bearer itself — the handoff exchange then needs no
  // server-side secret injection.
  const publishableKey = getPublishableKey();
  const project = useMemo<ZitadelProject | undefined>(
    () =>
      projectId ? Object.freeze({ projectId, proxyPath: apiBase, publishableKey }) : undefined,
    [projectId, publishableKey],
  );

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <ZitadelMark size={40} className="text-foreground" aria-hidden />
      <h1 className="sr-only">Sign in to the Zitadel console</h1>
      {project ? (
        <ZitadelLogin
          project={project}
          purpose="login"
          theme={theme}
          postSignInUrl={postSignInUrl}
        />
      ) : (
        <NoProjectYet />
      )}
    </main>
  );
}

/**
 * Rendered while the deployment has no project. Under Console ADR 0004 §2's
 * transitional cutover rule, the server still discovers the first-created or
 * explicitly pinned project until a human-usable seed transport replaces that
 * fallback. Refreshing after `zitadel setup` picks the new project up via the
 * runtime document.
 */
function NoProjectYet() {
  return (
    <div className="flex max-w-md flex-col gap-3 text-center">
      <h2 className="font-serif text-xl text-foreground">No project yet</h2>
      <p className="text-sm text-muted-foreground">
        This deployment has no project to sign in to. Create one from your application with{" "}
        <code className="rounded bg-accent px-1.5 py-0.5 text-foreground">
          npx @zitadel/cli setup
        </code>{" "}
        — the first project becomes the console&apos;s default. Then refresh this page.
      </p>
    </div>
  );
}
