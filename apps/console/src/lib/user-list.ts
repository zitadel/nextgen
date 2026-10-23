import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";

import { displayValue, field, isPresent } from "./record";
import { type SchemaField, type UserSchema, schemaFields } from "./schema";
import {
  type UserTeam,
  userAttributes,
  userIdentifier,
  userIdentity,
  userIdentitySecondary,
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
): Promise<UsersPage & { teamsExpanded: boolean }> {
  const body = { limit: PAGE_SIZE, page_token: pageToken };
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
      limit: PAGE_SIZE,
      page_token: pageToken,
      filter: [{ field: "team_id", operation: "equals", value: teamId }],
    },
    { project_id: projectId },
  );
}

/**
 * The properties one schema gives the users that reference it: what the
 * Columns menu offers to pin, grouped under the schema it belongs to.
 */
export interface ColumnGroup {
  /** The users' `schema`; empty for users that carry none. */
  schemaId: string;
  /** The schema's `title`, else its id. */
  title: string;
  fields: SchemaField[];
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
): Promise<ColumnGroup[]> {
  const schemaIds = [...new Set(users.map((user) => field(user, "schema")).filter(isPresent))];
  const fetched = await Promise.all(
    schemaIds.map(async (id) => {
      try {
        return (await api.getSchemaById(id, { project_id: projectId })).schema as UserSchema;
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

/**
 * A group per schema the users reference. A schema that did not load, and the
 * users with no schema at all, offer the attribute keys their users carry.
 */
function columnsFor(
  users: Record<string, unknown>[],
  schemas: Map<string, UserSchema>,
): ColumnGroup[] {
  const groups = new Map<string, ColumnGroup>();
  const fallback = new Map<string, Set<string>>();
  for (const user of users) {
    const schemaId = field(user, "schema") ?? "";
    const schema = schemas.get(schemaId);
    if (schema) {
      if (!groups.has(schemaId)) {
        const title = field(schema, "title") ?? schemaId;
        groups.set(schemaId, { schemaId, title, fields: schemaFields(schema) });
      }
      continue;
    }
    if (!groups.has(schemaId)) {
      groups.set(schemaId, { schemaId, title: schemaId || "No schema", fields: [] });
      fallback.set(schemaId, new Set());
    }
    for (const key of Object.keys(userAttributes(user))) fallback.get(schemaId)?.add(key);
  }
  for (const [schemaId, keys] of fallback) {
    const group = groups.get(schemaId);
    if (!group) continue;
    group.fields = [...keys].sort().map((key) => ({
      key,
      label: key,
      required: false,
      inputType: "text" as const,
    }));
  }
  return [...groups.values()];
}

export interface UserRow {
  id: string;
  /** The user's `schema`; empty when it carries none. */
  schemaId: string;
  /**
   * The rendered identity (display → identifier → id, ADR 058) — the User
   * column, the row menu's accessible name, and the delete dialog's heading.
   */
  name: string;
  /** The designated identifier, whether or not it is the row's `name`. */
  identifier?: string;
  /**
   * The identifier as a muted line under `name`: set only when a display name
   * leads, since the identifier is `name` itself otherwise.
   */
  secondary?: string;
  /** The schema property the identifier came from (e.g. "email"), as the line's tooltip. */
  identifierProperty?: string;
  /** The user's whole `attributes` tree, as the Attributes popover shows it. */
  attributes: Record<string, unknown>;
  /**
   * Every attribute key, the schema's properties first in its field order and
   * any the schema does not declare after them, sorted.
   */
  attributeKeys: string[];
  /** Rendered scalar values, keyed by attribute. */
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
  groups: ColumnGroup[],
): UserRow {
  const id = field(user, "id") ?? `unknown-user-${index}`;
  const schemaId = field(user, "schema") ?? "";
  const attributes = userAttributes(user);
  const declared = groups.find((group) => group.schemaId === schemaId)?.fields ?? [];
  const keys = new Set(declared.map((entry) => entry.key).filter((key) => key in attributes));
  for (const key of Object.keys(attributes).sort()) keys.add(key);
  const values: Record<string, string> = {};
  for (const key of keys) {
    // Only scalars are read. A property whose value is an object or array has no
    // one-line rendering, and `JSON.stringify` in a table cell is noise — the
    // Attributes popover and the detail screen are where a structured attribute
    // belongs.
    const value = displayValue(attributes, key);
    if (value !== undefined) values[key] = value;
  }
  return {
    id,
    schemaId,
    attributes,
    attributeKeys: [...keys],
    values,
    name: userIdentity(user) ?? id,
    identifier: userIdentifier(user),
    secondary: userIdentitySecondary(user),
    identifierProperty: field(user, "identifier_property"),
    status: userMetadata(user).status,
    teams: userTeams(user),
    teamsTruncated: user.teams_truncated === true,
  };
}

/** Whether a row's value only repeats what its User cell already shows. */
function repeatsIdentity(row: UserRow, key: string): boolean {
  const value = row.values[key];
  return value !== undefined && (value === row.name || value === row.identifier);
}

/**
 * The properties of a schema that tell the reader something the User cell
 * does not, which are the ones the Columns menu offers to pin.
 *
 * The User cell already shows each row's display name and identifier, and the
 * identifier is usually a schema property too: under the default schema the
 * email would otherwise read twice in one row (D20). A property is dropped
 * when every value its rows hold repeats that row's name or identifier; one
 * with any other value stays. One no row has a value for is kept.
 */
export function columnsBeyondIdentity(columns: SchemaField[], rows: UserRow[]): SchemaField[] {
  return columns.filter((column) => {
    let repeats = false;
    for (const row of rows) {
      if (row.values[column.key] === undefined) continue;
      if (!repeatsIdentity(row, column.key)) return true;
      repeats = true;
    }
    return !repeats;
  });
}

/** The pinned properties of each schema, by schema id. */
export type ColumnPins = Record<string, string[]>;

/** A pinned property, rendered as its own column. */
export interface PinnedColumn {
  key: string;
  label: string;
}

/**
 * The pinned columns, in the groups' order and each group's field order.
 *
 * A pin names one schema's property, but the column is the property: a key
 * two schemas share is one column, and every row with a value for it shows
 * that value there, whichever schema's pin made the column. An em dash under
 * a pinned "Family name" would otherwise read as "has none".
 */
export function pinnedColumns(groups: ColumnGroup[], pins: ColumnPins): PinnedColumn[] {
  const columns = new Map<string, PinnedColumn>();
  for (const group of groups) {
    const pinned = new Set(pins[group.schemaId] ?? []);
    for (const entry of group.fields) {
      if (pinned.has(entry.key) && !columns.has(entry.key)) {
        columns.set(entry.key, { key: entry.key, label: entry.label });
      }
    }
  }
  return [...columns.values()];
}

/** How many attributes the Attributes cell names before it counts the rest. */
const SUMMARY_LENGTH = 3;

/** The one-line Attributes cell: the first unpinned scalars and a count of the rest. */
export interface AttributeSummary {
  entries: { key: string; value: string }[];
  /** The unpinned attributes not named, structured ones included. */
  more: number;
}

/**
 * The attributes a row's Attributes cell summarises: every one no pinned
 * column shows and that does not repeat the User cell, in the row's attribute
 * order. Objects and arrays are counted, never rendered.
 */
export function attributeSummary(row: UserRow, columns: PinnedColumn[]): AttributeSummary {
  const shown = new Set(columns.map((column) => column.key));
  const rest = row.attributeKeys.filter(
    (key) => !(shown.has(key) && row.values[key] !== undefined) && !repeatsIdentity(row, key),
  );
  const entries: AttributeSummary["entries"] = [];
  for (const key of rest) {
    const value = row.values[key];
    if (value === undefined) continue;
    entries.push({ key, value });
    if (entries.length === SUMMARY_LENGTH) break;
  }
  return { entries, more: rest.length - entries.length };
}

/**
 * Pinned columns live in the viewer's browser, per project: a pin is a viewing
 * preference, not project configuration, and schema ids are unique per project
 * only.
 */
const PINS_STORAGE_KEY = "zl-console-users-columns";

function pinsStorageKey(projectId: string): string {
  return `${PINS_STORAGE_KEY}:${projectId}`;
}

/**
 * The viewer's pinned columns for a project. Nothing is pinned when storage is
 * unavailable (privacy mode, a blocked origin) or holds something unreadable.
 */
export function readColumnPins(projectId: string): ColumnPins {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(pinsStorageKey(projectId)) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const pins: ColumnPins = {};
    for (const [schemaId, keys] of Object.entries(stored)) {
      if (!Array.isArray(keys)) continue;
      pins[schemaId] = keys.filter((key): key is string => typeof key === "string");
    }
    return pins;
  } catch {
    return {};
  }
}

/** Persists the viewer's pinned columns. A failed write keeps them for this visit only. */
export function writeColumnPins(projectId: string, pins: ColumnPins): void {
  try {
    localStorage.setItem(pinsStorageKey(projectId), JSON.stringify(pins));
  } catch {
    /* storage unavailable: the pins last until the page is left */
  }
}
