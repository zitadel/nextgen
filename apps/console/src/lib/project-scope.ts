import { useRouter, useSearch } from "@tanstack/react-router";

import { api } from "../api/zitadel";
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
 * Projects screen pages the list itself and does not use this.
 */
export const listMyProjectsCached = sessionCached(() => api.listMyProjects(), 15_000);

/** `validateSearch` for the `_authed` layout: an id, or nothing. */
export function validateProjectScopeSearch(search: Record<string, unknown>): ProjectScopeSearch {
  const project = search[PROJECT_SCOPE_PARAM];
  return typeof project === "string" && project.trim() !== ""
    ? { project: project.trim() }
    : {};
}

/**
 * The project to select when a screen is opened without one, or `undefined`
 * when the person has to choose.
 *
 * Only a project the person can act on is ever chosen for them — one
 * `GET /users/me/projects` lists — because the session authorizes every
 * management call through their grants on it (#1300). Standalone optimises for
 * one project (ADR 0004 §6), so:
 *
 * 1. The `VITE_CONSOLE_PROJECT_ID` dev pin, when it is one of their projects.
 *    A pin they hold no grant on is ignored: in `dev-real --claim` it names the
 *    platform project, which the claiming developer cannot manage.
 * 2. Otherwise, their only project.
 * 3. With none or several, nothing: scoped screens go to Projects, which lists
 *    the choice or says there is none.
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
  const more = Boolean(page.next_page_token);
  const pinned = import.meta.env.VITE_CONSOLE_PROJECT_ID;
  if (pinned && (await canManage(pinned, projects, more))) return pinned;
  return projects.length === 1 && !more ? projects[0]?.id : undefined;
}

/**
 * Whether `project` is one of the person's. The list is one page; past it,
 * `GET /projects/{id}` answers a session only for a project it holds a grant
 * on, so a pin further down the list is still recognised without walking it.
 */
async function canManage(
  project: string,
  listed: { id: string }[],
  more: boolean,
): Promise<boolean> {
  if (listed.some((entry) => entry.id === project)) return true;
  if (!more) return false;
  try {
    await api.getProject(project);
    return true;
  } catch {
    return false;
  }
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
