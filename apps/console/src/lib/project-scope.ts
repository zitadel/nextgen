import { useRouter, useSearch } from "@tanstack/react-router";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { useAsync } from "@/hooks/use-async";

import { sessionCached } from "./session-cache";

/**
 * The console's selected project (Console ADR 0004 §§1, 5–6).
 *
 * The Console signs into one project and manages others: "customer projects
 * remain ordinary protected resources selected after sign-in". The selection
 * lives in the URL as `?project=<id>` on the `_authed` layout, retained across
 * every navigation (`retainSearchParams` in `routes/_authed.tsx`), so it
 * survives a refresh and a shared link, and the route stays the one source the
 * shell and the screens read from (Console ADR 0001).
 *
 * Any screen opened without a selection gets the default one from the `_authed`
 * guard (`resolveDefaultProjectScope`). Screens that act on one project declare
 * `staticData.scope: "project"`. That flag does two things: the sidebar lists
 * the screen only while a project is selected (`use-nav-items.ts`), and with no
 * default to fill in, the guard sends it to Projects with the requested
 * location in `?next=` (`useSelectProjectTarget`).
 */

/** The search param that carries the selected project id. */
export const PROJECT_SCOPE_PARAM = "project";

/** What a route declares to say it acts on the selected project. */
export type RouteScope = "project";

export interface ProjectScopeSearch {
  project?: string;
}

/**
 * `GET /users/me/projects`, shared by the `_authed` guard and the project
 * switcher: on a landing both need it, and one request answers both. The
 * Projects screen pages the list itself and does not use this. Like that
 * screen's read, it holds the cookie's session to the console's project, so an
 * app's session the cookie holds is refused rather than listed as this
 * person's projects.
 */
export const listMyProjectsCached = sessionCached(
  () => api.listMyProjects(consoleSessionProject()),
  15_000,
);

/** A project as the chrome names it. */
export interface ProjectRef {
  id: string;
  name: string;
}

/**
 * The person's projects for chrome (the switcher, search), from
 * `GET /users/me/projects` (ADR 053 §6): their own and the ones granted to
 * them. `POST /projects/query` cannot serve this — it is pinned to the
 * credential's home project. One page, shared with the `_authed` guard's
 * default-selection read; the Projects screen pages the full set. `more` says
 * the page is not all of them, so the rest are found by searching
 * (`searchMyProjects`), never by filtering this page.
 * `undefined` while loading, no projects when there are none or the read
 * failed: the chrome degrades rather than blocking a screen behind a boundary.
 */
export function useMyProjects(): { projects: ProjectRef[]; more: boolean } | undefined {
  return useAsync(
    () =>
      listMyProjectsCached().then((page) => ({
        projects: page.projects.map(toProjectRef),
        more: Boolean(page.next_page_token),
      })),
    { projects: [], more: false },
    [],
  );
}

/**
 * Up to `limit` of the person's projects whose name contains `nameContains`,
 * ignoring case. The server matches them together with the grants
 * (`name_contains`), so a search reaches every project the person can act on,
 * however many there are, rather than the one page the chrome holds.
 */
export async function searchMyProjects(nameContains: string, limit: number): Promise<ProjectRef[]> {
  const page = await api.listMyProjects({
    name_contains: nameContains,
    limit,
    ...consoleSessionProject(),
  });
  return page.projects.map(toProjectRef);
}

function toProjectRef({ id, name }: ProjectRef): ProjectRef {
  return { id, name };
}

/**
 * The selected project, named for the chrome (the project pill, search's
 * headings): from the person's first page of projects when it is there, and
 * otherwise by `GET /projects/{id}`, since a project found by searching, or
 * named by a shared link's `?project=`, is often past that page. `name` is
 * `undefined` until that read answers, and stays so if it is refused.
 * `undefined` while nothing is selected or the first page is loading.
 */
export function useSelectedProject(): { id: string; name: string | undefined } | undefined {
  const selected = useProjectScope();
  const mine = useMyProjects();
  const listed = selected ? mine?.projects.find((project) => project.id === selected) : undefined;
  const missing = selected !== undefined && mine !== undefined && listed === undefined;
  // Tagged with the id it answers for: a re-read keeps the last answer until
  // the next lands, and that must not name another project.
  const read = useAsync(
    missing && selected
      ? () => api.getProject(selected).then((project) => ({ id: selected, name: project.name }))
      : null,
    undefined,
    [missing, selected],
  );

  if (listed) return listed;
  if (!missing || !selected) return undefined;
  return { id: selected, name: read?.id === selected ? read.name : undefined };
}

/** `validateSearch` for the `_authed` layout: an id, or nothing. */
export function validateProjectScopeSearch(search: Record<string, unknown>): ProjectScopeSearch {
  const project = search[PROJECT_SCOPE_PARAM];
  return typeof project === "string" && project.trim() !== "" ? { project: project.trim() } : {};
}

/**
 * The project to select when a screen is opened without one, or `undefined`
 * when the person has to choose.
 *
 * Only a project the person can act on is ever chosen for them — one
 * `GET /users/me/projects` lists — because the session authorizes every
 * management call through their grants on it (#1300). Standalone optimises for
 * one project (ADR 0004 §6), so their only project is selected; with none or
 * several, nothing is, and scoped screens go to Projects, which lists the
 * choice or says there is none. One listed project is not the only one while
 * more pages follow.
 *
 * The sign-in project (`getConsoleProjectId()`) is deliberately not a
 * fallback. It is the platform project on a deployment that bootstraps one,
 * and selecting a project without a grant on it only turns every screen into
 * an authorization error. A failed read selects nothing for the same reason.
 */
export async function resolveDefaultProjectScope(): Promise<string | undefined> {
  let page: Awaited<ReturnType<typeof listMyProjectsCached>>;
  try {
    page = await listMyProjectsCached();
  } catch {
    return undefined;
  }
  const { projects } = page;
  return projects.length === 1 && !page.next_page_token ? projects[0]?.id : undefined;
}

/**
 * Where selecting a project goes: back to the screen the `_authed` guard sent
 * to Projects for want of a selection (`?next=` on `/projects`), now with the
 * project selected, or else the console's landing for that project. So a
 * shared link opened with several projects to choose from still ends where it
 * pointed once one is chosen.
 */
export function useSelectProjectTarget(): (project: string) => {
  to: "/";
  search: Record<string, unknown>;
} {
  const router = useRouter();
  const next = useSearch({ strict: false, select: (search) => search.next });
  return (project) => {
    if (!next) return { to: "/", search: { project } };
    const url = new URL(next, "http://console.invalid");
    const search = router.options.parseSearch(url.search) as Record<string, unknown>;
    // `next` is router-relative and sanitized on the way in (`sanitizeNextPath`).
    return { to: url.pathname as "/", search: { ...search, project } };
  };
}

/** The selected project id, or `undefined` when none is selected. */
export function useProjectScope(): string | undefined {
  return useSearch({ strict: false, select: (search) => search.project });
}

/**
 * The selected project id on a screen that declared `scope: "project"`. The
 * `_authed` guard never renders such a screen without one, so an empty value
 * here is a routing mistake and fails loudly rather than querying `""`.
 */
export function useRequiredProjectScope(): string {
  return requireProjectScope(useProjectScope());
}

/** Loader-side counterpart of {@link useRequiredProjectScope}. */
export function requireProjectScope(project: string | undefined): string {
  if (!project) throw new Error("No project selected for a project-scoped screen");
  return project;
}

/** `loaderDeps` for a scoped list: reload when the selection changes. */
export function projectScopeDeps({ search }: { search: ProjectScopeSearch }): {
  project: string | undefined;
} {
  return { project: search.project };
}

/**
 * An index route's `fullPath` ends in `/` (`/teams/`), while navigation spells
 * the same route without it (`/teams`).
 */
export function withoutTrailingSlash<T extends string>(
  path: T,
): T extends `${infer P}/` ? (P extends "" ? "/" : P) : T {
  return (path.length > 1 ? path.replace(/\/$/, "") : path) as never;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Set on screens that act on the selected project. */
    scope?: RouteScope;
  }
}
