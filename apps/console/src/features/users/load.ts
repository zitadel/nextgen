import { redirect } from "@tanstack/react-router";
import { fetchAllSchemas, fetchLatestSchemaId, fetchSchemaRevisions } from "@/features/schemas/api";
import type { UserSchema } from "@/features/schemas/model";
import { useSearchedLoad } from "@/hooks/use-searched-load";

import { columnsForUsers, type fetchUserDetail, fetchUsers } from "./api";
import type { UserLinks } from "./links";
import {
  OLDER_REVISIONS,
  type SchemaOption,
  type UsersSearch,
  schemaOptions,
  userFilter,
} from "./list";

/**
 * What the Users screens read: the list's load, the search that follows it
 * without a new load (`useUserSearch`), and a user's detail. Each takes the
 * project it reads, so the selected project's Users and the root's People,
 * the reserved platform project's (D41), share them.
 */

/**
 * The first page of a search, and what the screen draws around it. `list` is
 * the screen's own path, where an `older` filter it cannot apply drops back.
 */
export async function loadUsers(projectId: string, search: UsersSearch, list: UserLinks["list"]) {
  // The filter's options are the project's schemas at their latest revision;
  // the chosen schema's revisions, with whether each is in use, are read for
  // it alone. Both are chrome: unreadable, the list still renders, narrowed
  // by what the URL carries.
  const readingRevisions = search.schema
    ? fetchSchemaRevisions(projectId, search.schema, { inUse: true }).catch(() => [])
    : Promise.resolve([]);
  // `older` compares with the newest revision, so its users wait for it.
  // It is read as the latest of the type, not taken from the history,
  // which leaves out a revision the viewer may not read. Unreadable, the
  // URL would claim a filter the list cannot apply, so it drops back to the
  // schema alone.
  const older = search.revision === OLDER_REVISIONS ? search.schema : undefined;
  const latestId = older
    ? await fetchLatestSchemaId(projectId, older).catch(() => undefined)
    : undefined;
  if (older && !latestId) {
    throw redirect({
      to: list,
      search: (prev: Record<string, unknown>) => ({ ...prev, revision: undefined }),
    });
  }
  const filter = userFilter(search, latestId);
  const [page, options, revisions] = await Promise.all([
    fetchUsers(projectId, undefined, true, filter),
    fetchAllSchemas(projectId).then(schemaOptions, () => []),
    readingRevisions,
  ]);
  return {
    users: page.users,
    teamsExpanded: page.teamsExpanded,
    nextPageToken: page.next_page_token ?? undefined,
    columns: await columnsForUsers(projectId, page.users, latestDocuments(options)),
    options,
    revisions,
    filter,
    q: search.q,
    latestId,
  };
}

/**
 * A later term's first page. Only the rows depend on the term: the filter's
 * options, the revisions and the newest revision stay as the load read them.
 */
async function searchUsers(projectId: string, search: UsersSearch, base: LoadedUsers) {
  const filter = userFilter(search, base.latestId);
  const page = await fetchUsers(projectId, undefined, true, filter);
  return {
    ...base,
    users: page.users,
    teamsExpanded: page.teamsExpanded,
    nextPageToken: page.next_page_token ?? undefined,
    columns: await columnsForUsers(projectId, page.users, latestDocuments(base.options)),
    filter,
    q: search.q,
  };
}

export type LoadedUsers = Awaited<ReturnType<typeof loadUsers>>;

/** The latest revisions' documents, keyed by id: what `columnsForUsers` need not read again. */
export function latestDocuments(options: SchemaOption[]): Map<string, UserSchema> {
  return new Map(options.map((option) => [option.latestId, option.schema]));
}

/** The Users list as the latest search term has it (`useSearchedLoad`). */
export function useUserSearch(
  projectId: string,
  search: UsersSearch,
  fromRoute: LoadedUsers,
): { loaded: LoadedUsers; searching: boolean; searchError: string | undefined } {
  return useSearchedLoad(
    search.q,
    fromRoute,
    (base) => searchUsers(projectId, search, base),
    "Could not search the users.",
  );
}

/** Everything a user's detail shows (`fetchUserDetail`). */
export type LoadedUser = Awaited<ReturnType<typeof fetchUserDetail>>;
