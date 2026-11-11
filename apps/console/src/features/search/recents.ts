import { sessionKept } from "@/lib/session-cache";

import type { SearchHit } from "./model";

/**
 * What the person opened from search, most recent first, for each project.
 * The palette lists them before anything is typed.
 *
 * Kept in memory only, and dropped with the session: a hit carries an end
 * user's name and identifier, which do not belong in the browser's storage.
 * So it is this tab's, and a reload starts it empty.
 */
const recentByProject = sessionKept(() => new Map<string, SearchHit[]>());

/** How many are kept for a project. */
export const RECENT_HIT_LIMIT = 5;

/** The project's recent hits, most recent first. */
export function recentHits(projectId: string): SearchHit[] {
  return recentByProject().get(projectId) ?? [];
}

/** Puts `hit` first, once. */
export function rememberHit(projectId: string, hit: SearchHit): void {
  const others = recentHits(projectId).filter(
    (recent) => recent.type !== hit.type || recent.id !== hit.id,
  );
  recentByProject().set(projectId, [hit, ...others].slice(0, RECENT_HIT_LIMIT));
}
