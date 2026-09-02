import { field } from "./record";

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
export function userIdentity(user: Record<string, unknown>): string {
  return field(user, "display") ?? field(user, "identifier") ?? (field(user, "id") ?? "");
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
