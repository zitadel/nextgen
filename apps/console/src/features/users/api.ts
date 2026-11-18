import { api } from "@/api/zitadel";
import { fetchAllIdps, fetchUserIdentityLinks } from "@/features/authentication/api";
import { fetchLatestSchemaId, fetchSchemaRevisions } from "@/features/schemas/api";
import type { UserSchema } from "@/features/schemas/model";
import { field, isPresent } from "@/lib/record";
import { ApiError } from "@zitadel/api/runtime/fetch";
import type { UserFilter, ColumnGroup } from "./list";
import { columnsFor } from "./list";
import { userIdentity } from "./model";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { sessionKept } from "@/lib/session-cache";

type UsersPage = Awaited<ReturnType<typeof api.queryUsers>>;

/**
 * One page of the selected project's users, with each user's team memberships
 * embedded. `project_id` names the target (#1303): without it the server
 * answers for the caller's own project, which on a platform deployment is not
 * the one selected.
 *
 * `expand: ["teams"]` needs `team_membership.read` on top of `user.read`, and a
 * credential carrying one without the other is refused the whole request rather
 * than just the relation (ADR 059). A Console session passes when it may read
 * the whole project; a grant on only part of it is refused, and the refusal
 * falls back to the unexpanded read, so the screen loses its Team column, not
 * its users.
 *
 * `expand` is false once a page was served without the expansion: a refusal
 * does not turn into a pass by paging, so Load more asks for the plain page
 * directly instead of being refused first every time.
 */
export async function fetchUsers(
  projectId: string,
  pageToken?: string,
  expand = true,
  filter: UserFilter = [],
): Promise<UsersPage & { teamsExpanded: boolean }> {
  const body = {
    limit: LIST_PAGE_SIZE,
    page_token: pageToken,
    ...(filter.length > 0 ? { filter } : {}),
  };
  const params = { project_id: projectId };
  if (!expand) {
    return { ...(await api.queryUsers(body, params)), teamsExpanded: false };
  }
  try {
    return {
      ...(await api.queryUsers({ ...body, expand: ["teams"] }, params)),
      teamsExpanded: true,
    };
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 403) throw cause;
    return { ...(await api.queryUsers(body, params)), teamsExpanded: false };
  }
}

/**
 * One page of a team's members: the project's users holding an active
 * membership in it (`team_id`, ADR 024). The filter reads memberships, so it
 * needs `team_membership.read` like `expand: ["teams"]` does, and is refused
 * the same way to a grant on only part of the project.
 */
export function fetchTeamMembers(
  projectId: string,
  teamId: string,
  pageToken?: string,
): Promise<UsersPage> {
  return api.queryUsers(
    {
      limit: LIST_PAGE_SIZE,
      page_token: pageToken,
      filter: [{ field: "team_id", operation: "equals", value: teamId }],
    },
    { project_id: projectId },
  );
}

/**
 * The column groups for a set of users, from the schemas those users reference,
 * in the users' first-seen order.
 *
 * Only the loaded users' schemas are fetched, not every schema in the project:
 * one nobody uses would offer properties that are blank in every row. Each user
 * carries `schema`, so the set is known without a second list call.
 *
 * Schema ids are unique per project only — the seeded default carries the same
 * `$id` everywhere — and the server resolves an ambiguous id in the caller's
 * own project, so `project_id` names the one these users live in.
 */
export async function columnsForUsers(
  projectId: string,
  users: Record<string, unknown>[],
  /** Documents already in hand (the filter's lineages), read again for nobody. */
  known: ReadonlyMap<string, UserSchema> = new Map(),
): Promise<ColumnGroup[]> {
  const schemaIds = [...new Set(users.map((user) => field(user, "schema")).filter(isPresent))];
  const fetched = await Promise.all(
    schemaIds.map(async (id) => {
      const held = known.get(id);
      if (held) return held;
      try {
        return (await api.getSchema(id, { project_id: projectId })).schema as UserSchema;
      } catch {
        // One unreadable schema costs its titles and labels, not the screen.
        // Its users still render from the fallback below.
        return undefined;
      }
    }),
  );
  // Keyed in the users' first-seen order, not in the order the reads finish:
  // the Columns menu and the pinned columns follow the map, and a race would
  // reshuffle them on every load.
  const loaded = new Map<string, UserSchema>();
  schemaIds.forEach((id, index) => {
    const schema = fetched[index];
    if (schema) loaded.set(id, schema);
  });
  return columnsFor(users, loaded);
}

/** Everything the user detail screen shows, read for its loader. */
export async function fetchUserDetail(userId: string, projectId: string) {
  const user = await api.getUser(userId);

  // All are chrome for the record rather than the record itself, so none is
  // allowed to reject the loader: a failure costs a row, not the screen.
  const schemaId = field(user, "schema");
  const readingSchema = schemaId
    ? api
        // Schema ids are unique per project only, so name the selected one.
        .getSchema(schemaId, { project_id: projectId })
        .then((value) => ({ id: value.id, schema: value.schema as UserSchema }))
        .catch(() => undefined)
    : Promise.resolve(undefined);
  const objectTypeOf = (read: Awaited<typeof readingSchema>) =>
    read && field(read.schema, "objectType");
  const [own, latestSchemaId, revisions, passkeys, identityLinks, passwordSetAt] =
    await Promise.all([
      readingSchema,
      // The schema's name opens the schema at its newest revision; the user
      // may be on an older one, which the revision box opens. Unreadable, the
      // name opens the user's own revision.
      readingSchema.then((value) => {
        const objectType = objectTypeOf(value);
        return objectType
          ? fetchLatestSchemaId(projectId, objectType).catch(() => undefined)
          : undefined;
      }),
      // What the user can be moved to. A schema stored without an `objectType` is a
      // revision of nothing, so it has no history and the server refuses any move.
      readingSchema.then((value) => {
        const objectType = objectTypeOf(value);
        return objectType ? fetchSchemaRevisions(projectId, objectType).catch(() => []) : [];
      }),
      api.listUserPasskeys.all(userId, { limit: 100 }).catch(() => undefined),
      fetchUserIdentityLinks(userId).catch(() => undefined),
      // `null`: the user has no password; `undefined`: it could not be read.
      api
        .getUserPasswordState(userId)
        .then((result) => result.set_at ?? null)
        .catch(() => undefined),
    ]);

  // A link names its connection by id; the connections give it a name. Only
  // read them when there is something to name, and fall back to the id when
  // they cannot be read.
  const idps =
    identityLinks && identityLinks.length > 0
      ? await fetchAllIdps(projectId).catch(() => null)
      : null;

  return {
    user,
    schema: own?.schema,
    // The row's own id, which a built-in schema's `user.schema` may spell differently.
    ownRevisionId: own?.id,
    latestSchemaId,
    revisions,
    passkeys,
    identityLinks,
    idps,
    passwordSetAt,
  };
}

/**
 * What each user is called now (`display`, else `identifier`), by ID: one
 * `GET /users/{id}` per user, read once for the signed-in person and shared by
 * every screen that names users by ID (Events' rows). The server finds the
 * user's project from the ID. A user who is gone, or one the person may not
 * read, has no name and stays an ID; that answer is not kept, and every name
 * is dropped with the session (`lib/session-cache.ts`).
 */
const userNames = sessionKept(() => new Map<string, Promise<string | undefined>>());

export async function readUserNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const kept = userNames();
  const names = await Promise.all(
    unique.map((id) => {
      let name = kept.get(id);
      if (!name) {
        const reading = api
          .getUser(id)
          .then((user) => userIdentity(user))
          .catch(() => {
            // Not kept: a later page asks again.
            if (kept.get(id) === reading) kept.delete(id);
            return undefined;
          });
        kept.set(id, reading);
        name = reading;
      }
      return name;
    }),
  );
  const named = new Map<string, string>();
  unique.forEach((id, index) => {
    const name = names[index];
    if (name && name !== id) named.set(id, name);
  });
  return named;
}
