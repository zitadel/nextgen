import { field, isPresent } from "./record";

/** Shared so a user without attributes keeps a stable identity across renders. */
const NO_ATTRIBUTES: Record<string, unknown> = Object.freeze({});

/**
 * The user's schema-defined content, the half of the record a user schema
 * describes. Read defensively: the screens type users as open records, so a
 * response without the object renders empty rather than throwing.
 */
export function userAttributes(user: Record<string, unknown>): Record<string, unknown> {
  const attributes = user.attributes;
  if (!attributes || typeof attributes !== "object") return NO_ATTRIBUTES;
  return attributes as Record<string, unknown>;
}

/**
 * The user's rendered identity per ADR 058: the envelope's derived `display`,
 * falling back to `identifier`, then the id. The fields are resolved by the
 * server from the schema's own `x-identifier`/`x-display` designations, so
 * the console carries zero designation logic — the convention-guessing
 * `userDisplayName` this replaces is gone with the platform's own resolver.
 *
 * Takes the whole user record: `display`/`identifier` are envelope fields,
 * not schema properties.
 */
export function userIdentity(user: Record<string, unknown>): string | undefined {
  return field(user, "display") ?? field(user, "identifier") ?? field(user, "id");
}

/** The envelope's designated identifier value, when the schema designates one. */
export function userIdentifier(user: Record<string, unknown>): string | undefined {
  return field(user, "identifier");
}

/**
 * The muted secondary line shown under a heading: the identifier, but only
 * when a display name is the primary (rendering the identifier twice says
 * nothing). The users list shows the identifier as its own column instead.
 */
export function userIdentitySecondary(user: Record<string, unknown>): string | undefined {
  return field(user, "display") ? field(user, "identifier") : undefined;
}

/**
 * The server-owned `metadata` block. Read defensively: it sits on an otherwise
 * open record, so a user written before it existed simply has none.
 *
 * `status` is one of `active`, `suspended`, `deactivated`, `pending_purge`.
 */
export function userMetadata(user: Record<string, unknown>): {
  status?: string;
  createdAt?: string;
} {
  const metadata = user.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  return { status: field(record, "status"), createdAt: field(record, "created_at") };
}

/** One embedded membership, reduced to what a cell renders and links to. */
export interface UserTeam {
  id: string;
  name: string;
}

/**
 * The teams `expand: ["teams"]` embedded.
 *
 * Read defensively for the same reason `metadata` is: `teams` is absent when the
 * request did not ask for it and `[]` when the user is on none, and the rows
 * this walks are typed as an open record.
 *
 * Every membership the endpoint returns is kept, `pending` ones included — it
 * omits the ones the user was removed from, so what arrives is the roster. An
 * entry missing either half is dropped: a name with no id cannot be linked, and
 * an id with no name has nothing to render.
 */
export function userTeams(user: Record<string, unknown>): UserTeam[] {
  if (!Array.isArray(user.teams)) return [];
  return user.teams
    .map((team) => {
      if (!team || typeof team !== "object") return undefined;
      const record = team as Record<string, unknown>;
      const id = field(record, "id");
      const name = field(record, "name");
      return id && name ? { id, name } : undefined;
    })
    .filter(isPresent);
}
