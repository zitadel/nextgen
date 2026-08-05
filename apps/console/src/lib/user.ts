import { field } from "./record";

/**
 * The user's human-readable name, mirroring the platform's identity contract
 * (`User.DisplayName` in `internal/domain/user.go` — the same derivation behind
 * `GET /sessions/me`'s `name`): an explicit `name` wins, otherwise the given and
 * family parts joined. The shipped presets spell them camelCase
 * (`packages/config/defaults/*.json`); snake_case stays accepted for schemas
 * authored that way.
 *
 * User schemas are free-form and `listUsers` returns the attribute tree verbatim,
 * so this reads only the conventional identity keys and returns `undefined` when
 * a schema names its properties differently. Callers fall back to the email and
 * then the id — inventing a name from an unrelated attribute is worse than
 * having none.
 */
export function userDisplayName(user: Record<string, unknown>): string | undefined {
  const explicit = field(user, "name");
  if (explicit) return explicit;
  const given = field(user, "givenName") ?? field(user, "given_name");
  const family = field(user, "familyName") ?? field(user, "family_name");
  const joined = [given, family].filter(Boolean).join(" ");
  return joined || undefined;
}
