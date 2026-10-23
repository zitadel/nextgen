import { useRouter, useSearch } from "@tanstack/react-router";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { useAsync } from "@/hooks/use-async";
import { TYPING_PAUSE_MS, useDebounced } from "@/hooks/use-debounced";

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
 * `staticData.scope: "project"`: with no default to fill in, the guard sends
 * such a screen to Projects with the requested location in `?next=`
 * (`useSelectProjectTarget`), which asks for a project before going on there.
 * The sidebar lists it either way (`use-nav-items.ts`, D22).
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
  /**
   * The host of the project's first primary origin off the local machine,
   * when it has one: what tells two projects of one name apart, as a site's
   * domain does.
   */
  host?: string;
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
  return useAsync(readMyProjects, { projects: [], more: false }, []);
}

function readMyProjects(): Promise<{ projects: ProjectRef[]; more: boolean }> {
  return listMyProjectsCached().then((page) => ({
    projects: page.projects.map(toProjectRef),
    more: Boolean(page.next_page_token),
  }));
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

/** What a project read carries that the chrome uses. */
interface ProjectRead {
  id: string;
  name: string;
  origins?: ReadonlyArray<{ pattern: string; kind: string }>;
}

function toProjectRef({ id, name, origins }: ProjectRead): ProjectRef {
  const host = primaryHost(origins);
  return host ? { id, name, host } : { id, name };
}

/**
 * The host of the first primary origin that parses and is not loopback
 * (`shop.example.com`). Preview patterns are left out: one may hold a `*`,
 * which names no host. So is the local machine, which many projects list for
 * development and so tells none of them apart.
 */
export function primaryHost(origins: ProjectRead["origins"]): string | undefined {
  for (const origin of origins ?? []) {
    if (origin.kind !== "primary") continue;
    try {
      const { host, hostname } = new URL(origin.pattern);
      if (host && !isLoopback(hostname)) return host;
    } catch {
      // The server keeps an unknown host as written; one that does not parse
      // names nothing to show.
    }
  }
  return undefined;
}

/**
 * Whether a hostname is the local machine, as the server reads an origin
 * (`domain.IsLoopbackOrigin`): localhost, a `*.localhost` name, or a loopback
 * address.
 */
function isLoopback(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

/** Names as a reader orders them: any case, and `app-2` before `app-10`. */
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** By name, then by id, so two projects of one name keep their places. */
export function byName<T extends { id: string; name: string }>(projects: readonly T[]): T[] {
  return [...projects].sort(
    (a, b) => NAME_ORDER.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Projects a search field lists, and the term they answer: empty for the first page. */
export interface ProjectMatches {
  term: string;
  projects: ProjectRef[];
}

/**
 * The project search behind the chrome's fields (the switcher, ⌘K). Once
 * typing pauses, up to `limit` of the server's matches for `query`
 * (`searchMyProjects`); with nothing typed, the first page, at once, since it
 * needs no request. An answer stays until the next one lands, so a list never
 * empties between keystrokes, and `term` says which search it answers. A
 * failed search finds nothing. `undefined` until the first answer.
 */
export function useProjectSearch(query: string, limit: number): ProjectMatches | undefined {
  const trimmed = query.trim();
  const term = useDebounced(trimmed, trimmed ? TYPING_PAUSE_MS : 0);
  return useAsync(
    () =>
      term
        ? searchMyProjects(term, limit).then((projects) => ({ term, projects }))
        : readMyProjects().then(({ projects }) => ({ term, projects })),
    { term, projects: [] },
    [term, limit],
  );
}

/**
 * The selected project, named for the chrome (the project pill, search's
 * headings): from the person's first page of projects when it is there, and
 * otherwise by `GET /projects/{id}`, since a project found by searching, or
 * named by a shared link's `?project=`, is often past that page. `name` is
 * `undefined` until that read answers, and stays so if it is refused.
 * `undefined` while nothing is selected or the first page is loading.
 */
export function useSelectedProject(): SelectedProject | undefined {
  const selected = useProjectScope();
  const mine = useMyProjects();
  const listed = selected ? mine?.projects.find((project) => project.id === selected) : undefined;
  const missing = selected !== undefined && mine !== undefined && listed === undefined;
  // Tagged with the id it answers for, a refusal too: a re-read keeps the last
  // answer until the next lands, and that must not name another project.
  const read = useAsync(
    missing && selected
      ? () =>
          api.getProject(selected).then(
            (project): SelectedProject => ({ ...toProjectRef(project), id: selected }),
            (cause: unknown): SelectedProject => {
              if (isRefusal(cause)) return { id: selected, name: undefined, refused: true };
              throw cause;
            },
          )
      : null,
    undefined,
    [missing, selected],
  );

  if (listed) return listed;
  if (!missing || !selected) return undefined;
  return read?.id === selected ? read : { id: selected, name: undefined };
}

/** The selected project, as {@link useSelectedProject} names it. */
export interface SelectedProject {
  id: string;
  /** `undefined` until the project is read, and for good once that is refused. */
  name: string | undefined;
  host?: string;
  /** Reading it was refused: the project is gone, or the person may not see it. */
  refused?: boolean;
}

/** A read refused for good: no such project (404), or not this person's to see (403). */
function isRefusal(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 403 || cause.status === 404);
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
