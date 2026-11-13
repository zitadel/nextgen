import {
  Outlet,
  createFileRoute,
  redirect,
  retainSearchParams,
  useRouter,
} from "@tanstack/react-router";

import { fetchSession, signOut } from "@/auth/session";
import { AppShell } from "@/app-shell/app-shell";
import { clearInvitationToken } from "@/features/invitations/token";
import { routerRelativeHref, withoutTrailingSlash } from "@/lib/base-path";
import { readPlatformAccess } from "@/features/platform/access";
import {
  PROJECT_SCOPE_PARAM,
  isRootPath,
  resolveDefaultProjectScope,
  selectsPlatformProject,
  validateProjectScopeSearch,
} from "@/features/projects/project-scope";

/**
 * Pathless layout route owning console authentication (Console ADR 0003).
 *
 * Every console screen lives under this layout, so the guard below runs
 * before any of them load: `fetchSession()` confirms the session
 * cookie against `GET /sessions/me`, and an unauthenticated visitor is
 * redirected to `/login` with the originally requested path in `?next=` so
 * deep links survive the round trip.
 *
 * It also owns the selected project (`src/features/projects/project-scope.ts`): `?project=`
 * is validated here and retained on every navigation beneath the layout, so a
 * sidebar link or a row link keeps the selection without naming it. The
 * root's own screens (Projects, Settings, the profile) are the exception:
 * they hold the root, the platform project for someone who may act on it and
 * no selection for anyone else, so going up never leaves a project selected
 * that the bar does not name (D44). Any
 * screen opened without a selection is redirected to itself with the default
 * one, so a single-project person gets it wherever they arrive. With no default
 * — several projects to choose from — an unscoped screen renders as it is, and
 * one declaring `staticData.scope: "project"` goes to Projects, carrying the
 * requested location in `?next=` so choosing a project ends there. The landing,
 * `/`, carries none: choosing a project then opens its Overview.
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
    // The root's screens hold the root, never a project (D44): the platform
    // project for someone who may act on it (D42), none for anyone else. So
    // they take no default either.
    if (leaf && isRootPath(withoutTrailingSlash(leaf.fullPath))) {
      const root = await readPlatformAccess().catch(() => undefined);
      if (search.project !== root) {
        throw redirect({
          to: withoutTrailingSlash(leaf.fullPath),
          params: leaf.params,
          search: { ...leaf.search, project: root },
          replace: true,
        });
      }
      return { session };
    }
    // The reserved platform project is the root (D42): its screens are the
    // root's, for someone who may act on it. For anyone else a URL naming it
    // goes on without it, and gets the default like any project they cannot
    // choose. `undefined` removes the retained key, which leaving it out
    // would keep.
    if (
      leaf &&
      selectsPlatformProject(location.search) &&
      !(await readPlatformAccess().catch(() => undefined))
    ) {
      throw redirect({
        to: withoutTrailingSlash(leaf.fullPath),
        params: leaf.params,
        search: { ...leaf.search, project: undefined },
        replace: true,
      });
    }
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
        // `/`, the project's Overview, is where arriving at the console lands:
        // it asked for no screen, so it is Projects itself rather than the way
        // to Overview (D22).
        const landing = withoutTrailingSlash(leaf.fullPath) === "/";
        throw redirect({
          to: "/projects",
          search: landing ? {} : { next: routerRelativeHref(location.href) },
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
    // An invitation link opened in this tab was the person's who just left.
    clearInvitationToken();
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
