import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";

import { displayValue, field, isPresent } from "./record";
import { type SchemaField, type UserSchema, schemaColumns } from "./schema";
import {
  type UserTeam,
  userAttributes,
  userIdentifier,
  userIdentity,
  userMetadata,
  userTeams,
} from "./user";

type UsersPage = Awaited<ReturnType<typeof api.queryUsers>>;

/**
 * One page of users. `POST /users/query` is cursor-paginated, so the size is a page
 * size rather than a cap on what the operator can reach — `Load more` walks the
 * rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

/**
 * One page of the selected project's users, with each user's team memberships
 * embedded. `project_id` names the target (#1303): without it the server
 * answers for the caller's own project, which on a platform deployment is not
 * the one selected.
 *
 * `expand: ["teams"]` needs `team_membership.read` on top of `user.read`, and a
 * credential carrying one without the other is refused the whole request rather
 * than just the relation (ADR 059). A Console session passes once it may list
 * the project (#1306); the refusal still falls back to the unexpanded read for
 * a credential that may not, so the screen loses its Team column, not its users.
 */
export async function fetchUsers(
  projectId: string,
  pageToken?: string,
): Promise<UsersPage & { teamsExpanded: boolean }> {
  const body = { limit: PAGE_SIZE, page_token: pageToken };
  const params = { project_id: projectId };
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
 * Columns for a set of users, from the schemas those users reference.
 *
 * Only the loaded users' schemas are fetched, not every schema in the project:
 * one nobody uses would add a column that is blank in every row. Each user
 * carries `schema`, so the set is known without a second list call.
 *
 * Schema ids are unique per project only — the seeded default carries the same
 * `$id` everywhere — and the server resolves an ambiguous id in the caller's
 * own project, so `project_id` names the one these users live in.
 */
export async function columnsForUsers(
  projectId: string,
  users: Record<string, unknown>[],
): Promise<SchemaField[]> {
  const schemaIds = [...new Set(users.map((user) => field(user, "schema")).filter(isPresent))];
  const loaded = new Map<string, UserSchema>();
  await Promise.all(
    schemaIds.map(async (id) => {
      try {
        loaded.set(id, (await api.getSchemaById(id, { project_id: projectId })).schema as UserSchema);
      } catch {
        // One unreadable schema costs its columns, not the screen. Its users
        // still render from the fallback below.
      }
    }),
  );
  return columnsFor(users, loaded);
}

/**
 * Columns from the users' schemas, plus a column for every attribute key of a
 * user whose schema did not load. A user with no schema at all counts as such.
 */
function columnsFor(
  users: Record<string, unknown>[],
  schemas: Map<string, UserSchema>,
): SchemaField[] {
  const columns = schemaColumns([...schemas.values()]);
  const known = new Set(columns.map((column) => column.key));
  const keys = new Set<string>();
  for (const user of users) {
    const schemaId = field(user, "schema");
    if (schemaId && schemas.has(schemaId)) continue;
    for (const key of Object.keys(userAttributes(user))) {
      if (!known.has(key)) keys.add(key);
    }
  }
  const fallback = [...keys].sort().map((key) => ({
    key,
    label: key,
    required: false,
    inputType: "text" as const,
  }));
  return [...columns, ...fallback];
}

export interface UserRow {
  id: string;
  /**
   * The rendered identity (display → identifier → id, ADR 058) — the User
   * column, the row menu's accessible name, and the delete dialog's heading.
   */
  name: string;
  /** The designated identifier — its own column: platform-derived like Status
   * and ID, so it sits outside the schema-driven set (D4). */
  identifier?: string;
  /** The schema property the identifier came from (e.g. "email"), as the cell's tooltip. */
  identifierProperty?: string;
  /** Rendered cell values, keyed by schema property. */
  values: Record<string, string>;
  /** `metadata.status`, absent on a record the server has not stamped. */
  status?: string;
  /** The teams the user belongs to, empty when the user is on none. */
  teams: UserTeam[];
  /** True when the user is on more teams than the embedded list carries. */
  teamsTruncated: boolean;
}

export function toUserRow(
  user: Record<string, unknown>,
  index: number,
  columns: SchemaField[],
): UserRow {
  const id = field(user, "id") ?? `unknown-user-${index}`;
  const attributes = userAttributes(user);
  const values: Record<string, string> = {};
  for (const column of columns) {
    // Only scalars are read. A property whose value is an object or array has no
    // one-line rendering, and `JSON.stringify` in a table cell is noise — the
    // detail screen is where a structured attribute belongs.
    const value = displayValue(attributes, column.key);
    if (value !== undefined) values[column.key] = value;
  }
  return {
    id,
    values,
    name: userIdentity(user) ?? id,
    identifier: userIdentifier(user),
    identifierProperty: field(user, "identifier_property"),
    status: userMetadata(user).status,
    teams: userTeams(user),
    teamsTruncated: user.teams_truncated === true,
  };
}
