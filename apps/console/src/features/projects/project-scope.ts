import { useRouter, useSearch } from "@tanstack/react-router";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { type ReactNode, createContext, createElement, useContext } from "react";

import { api } from "@/api/zitadel";
import { useAsync } from "@/hooks/use-async";
import { getPlatformProjectId } from "@/runtime/runtime";

import { toProjectRef } from "./model";
import { listMyProjectsCached, useMyProjects } from "./my-projects";

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
 * Whether `?project=` names the reserved platform project, which is never
 * selected (D41): the root draws it. The `_authed` guard drops such a
 * selection from the URL, as the router keeps a raw search key in every
 * match whatever `validateSearch` answers.
 */
export function selectsPlatformProject(search: Record<string, unknown>): boolean {
  const platform = getPlatformProjectId();
  const project = search[PROJECT_SCOPE_PARAM];
  return !!platform && typeof project === "string" && project.trim() === platform;
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
 * The project a root page manages in place of the selection (D41): the
 * root's Users and Events draw the project screens' components for the
 * reserved platform project, which is never selected. Set by
 * {@link ManagedProject} around such a page.
 */
const ManagedProjectContext = createContext<string | undefined>(undefined);

/**
 * Renders `children` as managing project `id` rather than the selection, so a
 * project screen's components (an Add user sheet, a branding preview) act on
 * it. The selection, and the chrome that names it, stay as they are (D36).
 */
export function ManagedProject({ id, children }: { id: string; children: ReactNode }) {
  return createElement(ManagedProjectContext.Provider, { value: id }, children);
}

/**
 * The project a screen's components act on: the one {@link ManagedProject}
 * names on a root page, else the selected project. `scope: "project"` screens
 * are never rendered without one, so an empty value here is a routing mistake
 * and fails loudly rather than querying `""`.
 */
export function useRequiredProjectScope(): string {
  const managed = useContext(ManagedProjectContext);
  const selected = useProjectScope();
  return requireProjectScope(managed ?? selected);
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

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Set on screens that act on the selected project. */
    scope?: RouteScope;
  }
}
