import { useSearch } from "@tanstack/react-router";

import { api } from "../api/zitadel";
import { getConsoleProjectId } from "../runtime/runtime";

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
 * Screens that act on one project declare `staticData.scope: "project"`. That
 * flag does two things: the sidebar lists the screen only while a project is
 * selected (`use-nav-items.ts`), and the `_authed` guard fills in a default
 * selection when such a screen is opened without one.
 */

/** The search param that carries the selected project id. */
export const PROJECT_SCOPE_PARAM = "project";

/** What a route declares to say it acts on the selected project. */
export type RouteScope = "project";

export interface ProjectScopeSearch {
  project?: string;
}

/** `validateSearch` for the `_authed` layout: an id, or nothing. */
export function validateProjectScopeSearch(search: Record<string, unknown>): ProjectScopeSearch {
  const project = search[PROJECT_SCOPE_PARAM];
  return typeof project === "string" && project.trim() !== ""
    ? { project: project.trim() }
    : {};
}

/**
 * The project to select when a project-scoped screen is opened without one, or
 * `undefined` when the person has to choose.
 *
 * Standalone optimises for one project (ADR 0004 §6), so a single choice is
 * made for them:
 *
 * 1. The `VITE_CONSOLE_PROJECT_ID` dev override is an explicit pin — it names
 *    the project the dev proxy's secret belongs to — and wins outright.
 * 2. Otherwise, the one project `GET /users/me/projects` returns.
 * 3. With none returned, the discovered sign-in project. That is today's
 *    standalone fallback (ADR 0004 §2), where the Console signs into the
 *    customer project it manages and its operator may hold no grant at all.
 * 4. With several, nothing: the Projects screen is where they pick.
 *
 * A failed read degrades to step 3 rather than blocking every screen.
 */
export async function resolveDefaultProjectScope(): Promise<string | undefined> {
  const pinned = import.meta.env.VITE_CONSOLE_PROJECT_ID;
  if (pinned) return pinned;

  const signIn = getConsoleProjectId() || undefined;
  let projects: { id: string }[];
  try {
    projects = (await api.listMyProjects()).projects;
  } catch {
    return signIn;
  }
  const [only, ...rest] = projects;
  if (!only) return signIn;
  return rest.length === 0 ? only.id : undefined;
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
