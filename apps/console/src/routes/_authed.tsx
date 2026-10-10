import {
  Outlet,
  createFileRoute,
  redirect,
  retainSearchParams,
  useRouter,
} from "@tanstack/react-router";

import { setActiveApi } from "@/api/zitadel";
import { fetchSession, signOut } from "@/auth/session";
import { AppShell } from "@/components/app-shell/app-shell";
import { routerRelativeHref } from "@/lib/base-path";
import {
  PROJECT_SCOPE_PARAM,
  regionOfProject,
  resolveDefaultProjectScope,
  validateProjectScopeSearch,
  withoutTrailingSlash,
} from "@/lib/project-scope";

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
 * sidebar link or a row link keeps the selection without naming it. Any
 * screen opened without a selection is redirected to itself with the default
 * one, so a single-project person gets it wherever they arrive. With no default
 * — several projects to choose from — an unscoped screen renders as it is, and
 * one declaring `staticData.scope: "project"` goes to Projects, carrying the
 * requested location in `?next=` so choosing a project ends there.
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
    // In platform mode the selected project's calls go to its region: point
    // the shared client there before any loader runs, and back at the home
    // while nothing is selected (`api/zitadel.ts`). A no-op in standalone.
    setActiveApi(search.project ? await regionOfProject(search.project) : undefined);
    const leaf = matches[matches.length - 1];
    if (!search.project && leaf) {
      const project = await resolveDefaultProjectScope();
      if (project) {
        throw redirect({
          to: withoutTrailingSlash(leaf.fullPath),
          params: leaf.params,
          search: { ...leaf.search, project },
          replace: true,
        });
      }
      if (leaf.staticData.scope === "project") {
        throw redirect({
          to: "/projects",
          search: { next: routerRelativeHref(location.href) },
          replace: true,
        });
      }
    }
    return { session };
  },
  component: AuthedLayout,
});

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
