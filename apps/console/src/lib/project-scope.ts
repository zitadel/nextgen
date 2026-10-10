import { useRouter, useSearch } from "@tanstack/react-router";
import type { ListMyProjects200ProjectsItem } from "@zitadel/api/generated/model";

import { apiForRegion, homeApi } from "@/api/zitadel";
import { type ConsoleRegion, getRegions, isPlatformMode } from "@/runtime/runtime";
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

/** A project the person can act on; in platform mode, with the region it lives in. */
export type MyProject = ListMyProjects200ProjectsItem & { region?: ConsoleRegion };

export interface MyProjects {
  projects: MyProject[];
  next_page_token?: string | null;
  /** Regions whose list could not be read (platform mode); empty otherwise. */
  unreachable: ConsoleRegion[];
}

/**
 * `GET /users/me/projects`, shared by the `_authed` guard and the project
 * switcher: on a landing both need it, and one request answers both. In
 * standalone the Projects screen pages the list itself and does not use this;
 * in platform mode it shows this one, read from every region.
 */
export const listMyProjectsCached = sessionCached(loadMyProjects, 15_000);

/**
 * The home's list in standalone. In platform mode the person's projects live
 * in the regions, each of which lists its own (the home holds none), so the
 * first page of every region is read and tagged with it; a region that cannot
 * be reached is reported, not fatal, so the others still show.
 */
async function loadMyProjects(): Promise<MyProjects> {
  if (!isPlatformMode()) {
    const page = await homeApi.listMyProjects();
    return { ...page, unreachable: [] };
  }
  const regions = getRegions();
  const results = await Promise.allSettled(
    regions.map((region) => apiForRegion(region).listMyProjects()),
  );
  const projects: MyProject[] = [];
  const unreachable: ConsoleRegion[] = [];
  for (const [index, result] of results.entries()) {
    const region = regions[index];
    if (!region) continue;
    if (result.status === "fulfilled") {
      projects.push(...result.value.projects.map((project) => ({ ...project, region })));
    } else {
      unreachable.push(region);
    }
  }
  return { projects, next_page_token: undefined, unreachable };
}

/**
 * The region a project lives in, in platform mode: `undefined` in standalone,
 * and for a project the person cannot act on, which then falls to the home
 * and answers like any unknown project would.
 */
export async function regionOfProject(projectId: string): Promise<ConsoleRegion | undefined> {
  if (!isPlatformMode()) return undefined;
  try {
    const { projects } = await listMyProjectsCached();
    return projects.find((project) => project.id === projectId)?.region;
  } catch {
    return undefined;
  }
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
