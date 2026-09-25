import {
  Outlet,
  createFileRoute,
  redirect,
  retainSearchParams,
  useRouter,
} from "@tanstack/react-router";

import { fetchSession, signOut } from "../auth/session";
import { AppShell } from "../components/app-shell/AppShell";
import {
  PROJECT_SCOPE_PARAM,
  resolveDefaultProjectScope,
  validateProjectScopeSearch,
  withoutTrailingSlash,
} from "../lib/project-scope";

/**
 * Pathless layout route owning console authentication (Console ADR 0003).
 *
 * Every console screen lives under this layout, so the guard below runs
 * before any of them load: `fetchSession()` confirms the `__nextgen_session`
 * cookie against `GET /sessions/me`, and an unauthenticated visitor is
 * redirected to `/login` with the originally requested path in `?next=` so
 * deep links survive the round trip.
 *
 * It also owns the selected project (`src/lib/project-scope.ts`): `?project=`
 * is validated here and retained on every navigation beneath the layout, so a
 * sidebar link or a row link keeps the selection without naming it. A screen
 * declaring `staticData.scope: "project"` opened without a selection is
 * redirected to itself with the default one, or to Projects when the person
 * has to choose.
 *
 * The layout also renders the `AppShell` (moved here from `__root` so the
 * login screen stays shell-less) and feeds it the signed-in identity from the
 * route context plus the sign-out action.
 */
export const Route = createFileRoute("/_authed")({
  validateSearch: validateProjectScopeSearch,
  search: { middlewares: [retainSearchParams([PROJECT_SCOPE_PARAM])] },
  beforeLoad: async ({ location, search, matches }) => {
    const session = await fetchSession();
    if (!session) {
      throw redirect({ to: "/login", search: { next: routerRelativeHref(location.href) } });
    }
    const leaf = matches[matches.length - 1];
    if (!search.project && leaf?.staticData.scope === "project") {
      const project = await resolveDefaultProjectScope();
      throw project
        ? redirect({
            to: withoutTrailingSlash(leaf.fullPath),
            params: leaf.params,
            search: { ...leaf.search, project },
            replace: true,
          })
        : redirect({ to: "/projects", replace: true });
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
      user={{
        display: session.user?.display,
        identifier: session.user?.identifier,
        userId: session.user_id ?? undefined,
      }}
      onSignOut={handleSignOut}
    >
      <Outlet />
    </AppShell>
  );
}
