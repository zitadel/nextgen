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
 * The user's human-readable name, mirroring the platform's identity contract
 * (`User.DisplayName` in `internal/domain/user.go` — the same derivation behind
 * `GET /sessions/me`'s `name`): an explicit `name` wins, otherwise the given and
 * family parts joined. The shipped presets spell them camelCase
 * (`packages/config/defaults/*.json`); snake_case stays accepted for schemas
 * authored that way.
 *
 * User schemas are free-form and `queryUsers` returns the attribute tree verbatim,
 * so this reads only the conventional identity keys and returns `undefined` when
 * a schema names its properties differently. Callers fall back to the email and
 * then the id — inventing a name from an unrelated attribute is worse than
 * having none.
 *
 * Takes the attributes object, not the whole user: `name` is a schema property.
 */
export function userDisplayName(attributes: Record<string, unknown>): string | undefined {
  const explicit = field(attributes, "name");
  if (explicit) return explicit;
  const given = field(attributes, "givenName") ?? field(attributes, "given_name");
  const family = field(attributes, "familyName") ?? field(attributes, "family_name");
  const joined = [given, family].filter(Boolean).join(" ");
  return joined || undefined;
}
