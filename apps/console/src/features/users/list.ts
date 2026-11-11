import type { api } from "@/api/zitadel";
import {
  type SchemaEntry,
  type SchemaColumn,
  type UserSchema,
  schemaDisplayName,
  schemaFlatFields,
} from "@/features/schemas/model";
import { displayValue, field } from "@/lib/record";
import { dateFilterStart, parseDateFilter } from "@/lib/resource-filter";
import { searchTerm } from "@/lib/search-params";
import {
  type UserTeam,
  userAttributes,
  userIdentifier,
  userIdentity,
  userIdentitySecondary,
  userMetadata,
  userTeams,
} from "./model";
import type { ColumnPins } from "./column-pins";

/**
 * What the Users list is narrowed to, as the URL carries it. A type, not an
 * interface, so it is the record of values `ResourceFilter` reads.
 */
export type UsersSearch = {
  /** The start of a user's identifier; absent for every user. */
  q?: string;
  /** A schema's object type; absent for every schema. */
  schema?: string;
  /** One revision's id, or `older` for every revision but the newest; absent for every revision. */
  revision?: string;
  /** One of `USER_STATUSES`; absent for every status. */
  status?: string;
  /** Created within a range that ends now, or since a day (`parseDateFilter`); absent for any time. */
  created?: string;
};

/** The revision filter's value for every revision of the schema but the newest. */
export const OLDER_REVISIONS = "older";

/** The filter's earlier `Latest only` choice; the newest revision is picked by its id now. */
const LEGACY_LATEST = "latest";

/**
 * `validateSearch` of a Users list (the project's, and the root's People):
 * the filter lives in the URL, as the Teams tabs do. It is a server-side
 * filter, so it belongs to the request the loader makes, is linkable and
 * survives a reload. Only what the filter can send is kept: a revision
 * belongs to a schema, so it goes without one, and `latest`, which earlier
 * links carry, names no revision.
 */
export function validateUsersSearch(search: Record<string, unknown>): UsersSearch {
  const schema = typeof search.schema === "string" && search.schema ? search.schema : undefined;
  const revision =
    schema &&
    typeof search.revision === "string" &&
    search.revision &&
    search.revision !== LEGACY_LATEST
      ? search.revision
      : undefined;
  // Every key, even unset: the router lays this over the raw search, so a
  // key left out would keep the URL's value.
  return {
    q: searchTerm(search.q),
    schema,
    revision,
    status: parseUserStatus(search.status),
    created: parseDateFilter(search.created),
  };
}

/** A user's lifecycle statuses, as the API names them. */
export const USER_STATUSES = ["active", "suspended", "deactivated", "pending_purge"] as const;

/** A status as a URL may carry it; anything else is no filter. */
export function parseUserStatus(value: unknown): string | undefined {
  return (USER_STATUSES as readonly unknown[]).includes(value) ? (value as string) : undefined;
}

export type UserFilter = NonNullable<Parameters<typeof api.queryUsers>[0]["filter"]>;

/** One schema as the Users filter offers it: its object type, title and newest revision. */
export interface SchemaOption {
  objectType: string;
  /** The newest revision's title, else its id. */
  title: string;
  /** The newest revision's id. */
  latestId: string;
  /** The newest revision's document, for the column groups. */
  schema: UserSchema;
}

/**
 * The filter's options from the project's schemas at their latest revision,
 * by title. A schema stored without an object type has no lineage to filter
 * by and is left out. The server calls every revision latest that none of its
 * type was created after, so two minted in the same instant both arrive; the
 * first listed (created at, then id, descending) stands for the type.
 */
export function schemaOptions(entries: SchemaEntry[]): SchemaOption[] {
  const byType = new Map<string, SchemaOption>();
  for (const entry of entries) {
    const objectType = field(entry.schema, "objectType");
    if (!objectType || byType.has(objectType)) continue;
    byType.set(objectType, {
      objectType,
      title: schemaDisplayName(entry.schema, entry.id),
      latestId: entry.id,
      schema: entry.schema,
    });
  }
  return [...byType.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The server-side criteria for a search (#1669). `q` is matched by the server
 * across every page, never against the rows already loaded: against the start
 * of the identifier, which an index answers, and the rows then come ordered by
 * identifier instead of newest first. Every revision of a
 * schema shares its `object_type`, and a user's `schema` is the revision it is
 * on: one revision is `schema equals` its id, and `older` is `schema not_equals`
 * the newest one's, `latestId`, which it needs. `created` starts at a moment
 * counted from `now`, so the criteria are built once per search and reused by
 * its later pages.
 */
export function userFilter(
  search: UsersSearch,
  latestId?: string,
  now: Date = new Date(),
): UserFilter {
  const criteria: UserFilter = search.q
    ? [{ field: "identifier", operation: "starts_with", value: search.q }]
    : [];
  if (search.schema) {
    criteria.push({ field: "schema_object_type", operation: "equals", value: search.schema });
    if (search.revision === OLDER_REVISIONS) {
      if (!latestId) throw new Error("`older` needs the newest revision's id");
      criteria.push({ field: "schema", operation: "not_equals", value: latestId });
    } else if (search.revision) {
      criteria.push({ field: "schema", operation: "equals", value: search.revision });
    }
  }
  if (search.status) {
    criteria.push({ field: "status", operation: "equals", value: search.status });
  }
  const since = search.created ? dateFilterStart(search.created, now) : undefined;
  if (since) {
    criteria.push({
      field: "created_at",
      operation: "greater_than_or_equal",
      value: since.toISOString(),
    });
  }
  return criteria;
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
  fields: SchemaColumn[];
  /** The schema document, for labels and formats below the top level; absent if it did not load. */
  schema?: UserSchema;
}

/**
 * A group per schema the users reference. A schema that did not load, and the
 * users with no schema at all, offer the attribute keys their users carry.
 */
export function columnsFor(
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
        groups.set(schemaId, { schemaId, title, fields: schemaFlatFields(schema), schema });
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
  /** The schema property the identifier came from (e.g. "email"), as its chip. */
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
  /** `metadata.created_at`. */
  createdAt?: string;
  /** `metadata.lifecycle_owner_team_id`: `null` when self-owned, absent when unreported. */
  lifecycleOwnerTeamId?: string | null;
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
  const metadata = userMetadata(user);
  const declared = groups.find((group) => group.schemaId === schemaId)?.fields ?? [];
  // Own keys only, and a lookup with no prototype: attributes are
  // customer-authored, and a property named `constructor` or `__proto__` is
  // data, not something inherited from `Object.prototype`.
  const keys = new Set(
    declared.map((entry) => entry.key).filter((key) => Object.hasOwn(attributes, key)),
  );
  for (const key of Object.keys(attributes).sort()) keys.add(key);
  const values: Record<string, string> = Object.create(null);
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
    status: metadata.status,
    createdAt: metadata.createdAt,
    lifecycleOwnerTeamId: metadata.lifecycleOwnerTeamId,
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
export function columnsBeyondIdentity(columns: SchemaColumn[], rows: UserRow[]): SchemaColumn[] {
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

/**
 * The pinned columns, in the groups' order and each group's field order.
 *
 * A pin names one schema's property, but the column is the property: a key
 * two schemas share is one column, and every row with a value for it shows
 * that value there, whichever schema's pin made the column. An em dash under
 * a pinned "Family name" would otherwise read as "has none".
 */
export function pinnedColumns(groups: ColumnGroup[], pins: ColumnPins): SchemaColumn[] {
  const columns = new Map<string, SchemaColumn>();
  for (const group of groups) {
    const pinned = new Set(pins[group.schemaId] ?? []);
    for (const entry of group.fields) {
      if (pinned.has(entry.key) && !columns.has(entry.key)) columns.set(entry.key, entry);
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
export function attributeSummary(row: UserRow, columns: SchemaColumn[]): AttributeSummary {
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
