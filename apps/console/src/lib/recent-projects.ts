import { useEffect } from "react";

import type { ProjectRef, SelectedProject } from "./project-scope";

/**
 * The projects a person opened last, most recent first, kept in this browser
 * for each person signed in to it. The project switcher opens on them, so the
 * projects in use are one click away however many the person can act on:
 * every project of the deployment, for a platform operator (ADR 075).
 *
 * A convenience, not a record: storage can be unavailable, cleared or edited,
 * so every access may fail quietly, what is read is checked, and nothing but
 * names to list is taken from it. A project leaves the list once opening it
 * is refused.
 */

/** How many are kept, the one open now among them. The switcher lists them all. */
export const RECENT_PROJECT_LIMIT = 5;

/** Per person: someone else signing in on this browser must not see them. */
const STORAGE_PREFIX = "zitadel.console.recent-projects:";

/** The person's recent projects, most recent first; none without a person. */
export function readRecentProjects(userId: string | undefined): ProjectRef[] {
  if (!userId) return [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isProjectRef).slice(0, RECENT_PROJECT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Puts `project` first, once. */
export function rememberRecentProject(userId: string, project: ProjectRef): void {
  const others = readRecentProjects(userId).filter((recent) => recent.id !== project.id);
  write(userId, [project, ...others]);
}

export function forgetRecentProject(userId: string, projectId: string): void {
  const recents = readRecentProjects(userId);
  if (recents.some((recent) => recent.id === projectId)) {
    write(
      userId,
      recents.filter((recent) => recent.id !== projectId),
    );
  }
}

/**
 * Keeps the selected project first among the person's recent ones once it is
 * named, wherever it was chosen (the switcher, Projects, search, a link), and
 * drops it when reading it is refused.
 */
export function useRememberRecentProject(
  userId: string | undefined,
  selected: SelectedProject | undefined,
): void {
  const { id, name, host, refused } = selected ?? {};
  useEffect(() => {
    if (!userId || !id) return;
    if (refused) {
      forgetRecentProject(userId, id);
    } else if (name !== undefined) {
      rememberRecentProject(userId, host ? { id, name, host } : { id, name });
    }
  }, [userId, id, name, host, refused]);
}

function write(userId: string, projects: ProjectRef[]): void {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + userId,
      JSON.stringify(projects.slice(0, RECENT_PROJECT_LIMIT)),
    );
  } catch {
    // Full or blocked: the list only saves the person a search.
  }
}

function isProjectRef(value: unknown): value is ProjectRef {
  if (!value || typeof value !== "object") return false;
  const { id, name, host } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id !== "" &&
    typeof name === "string" &&
    (host === undefined || typeof host === "string")
  );
}
