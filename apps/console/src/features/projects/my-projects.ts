import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { useAsync } from "@/hooks/use-async";
import { TYPING_PAUSE_MS, useDebounced } from "@/hooks/use-debounced";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { sessionCached } from "@/lib/session-cache";

import { type ProjectRef, toProjectRef } from "./model";

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

/** Projects a search field found, and the term they answer. */
export interface ProjectMatches {
  term: string;
  projects: ProjectRef[];
}

/**
 * The project search behind the chrome's fields (the switcher, ⌘K). Once
 * typing pauses, up to `limit` of the server's matches for `query`
 * (`searchMyProjects`). With nothing typed it reads nothing and holds none:
 * a field opens on `useMyProjects` instead. An answer stays until the next
 * one lands, so a list never empties between keystrokes, and `term` says
 * which search it answers. A failed search finds nothing. `undefined` until
 * the first answer.
 */
export function useProjectSearch(query: string, limit: number): ProjectMatches | undefined {
  const trimmed = query.trim();
  const term = useDebounced(trimmed, trimmed ? TYPING_PAUSE_MS : 0);
  return useAsync(
    term ? () => searchMyProjects(term, limit).then((projects) => ({ term, projects })) : null,
    { term, projects: [] },
    [term, limit],
  );
}

/**
 * The list's order, by creation time rather than by id: an id says nothing
 * about when a project was made (root ADR 047).
 */
const NEWEST_FIRST = "desc";

/**
 * One page of the Projects screen's list: the projects the signed-in person
 * can act on (root ADR 053 §6), newest first, narrowed to the names that
 * contain `q`. Read with the session cookie, not `POST /projects/query`, which
 * the server pins to the calling credential's one home project (#1237).
 *
 * The first page, or the one after `pageToken`, which must come from a page
 * of the same `q`: a token answers one question, and asking another with it is
 * not a narrower list but a meaningless one, or a refused one.
 */
export async function listProjectsPage(q: string | undefined, pageToken?: string) {
  const page = await api.listMyProjects({
    limit: LIST_PAGE_SIZE,
    page_token: pageToken,
    order: NEWEST_FIRST,
    name_contains: q,
    ...consoleSessionProject(),
  });
  return { projects: page.projects, nextPageToken: page.next_page_token ?? undefined, q };
}
