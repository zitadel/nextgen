import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { fetchSession, signOut } from "../auth/session";
import { AppShell } from "../components/app-shell/AppShell";

/**
 * Pathless layout route owning console authentication (Console ADR 0003).
 *
 * Every console screen lives under this layout, so the guard below runs
 * before any of them load: `fetchSession()` confirms the `__nextgen_session`
 * cookie against `GET /sessions/me`, and an unauthenticated visitor is
 * redirected to `/login` with the originally requested path in `?next=` so
 * deep links survive the round trip.
 *
 * The layout also renders the `AppShell` (moved here from `__root` so the
 * login screen stays shell-less) and feeds it the signed-in identity from the
 * route context plus the sign-out action.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const session = await fetchSession();
    if (!session) {
      throw redirect({ to: "/login", search: { next: routerRelativeHref(location.href) } });
    }
    return { session };
  },
  component: AuthedLayout,
});

/**
 * `location.href` is the raw history path, which includes the deployment
 * prefix (`/ui/console` in production builds). Strip the Vite `BASE_URL`
 * prefix so `next` is a router-relative path that both the router redirect
 * and the login screen's `postSignInUrl` (which re-joins the base) agree on.
 */
function routerRelativeHref(href: string): string | undefined {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const relative = base && href.startsWith(base) ? href.slice(base.length) : href;
  const normalized = relative.startsWith("/") ? relative : `/${relative}`;
  // The root is the login screen's default target; omit it to keep the URL clean.
  return normalized === "/" ? undefined : normalized;
}

function AuthedLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    await router.navigate({ to: "/login" });
  };

  return (
    <AppShell
      user={{ name: session.name, email: session.email, userId: session.user_id ?? undefined }}
      onSignOut={handleSignOut}
    >
      <Outlet />
    </AppShell>
  );
}
