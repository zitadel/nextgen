/**
 * Canonical-form normalizers for the two repo-config resource kinds.
 *
 * The sync engine compares `.zitadel/**` files against server responses;
 * the server echoes fields the author never wrote (an empty `audience`
 * on flows) and the meta-schema declares defaults an author may or may
 * not spell out (`x-editable` et al on schema properties). Normalizing
 * both sides before hashing or diffing keeps a one-field edit rendering
 * as a one-field diff.
 *
 * Normalized bodies are for COMPARISON. Never upload them, and never
 * write a normalized schema body to a file: the server stores schema
 * bytes verbatim without materializing meta-schema defaults, so a
 * stripped `"x-editable": true` would vanish from the next published
 * revision. (Flow write-back may reuse {@link normalizeFlowBody} —
 * everything it strips is pure transport noise.)
 */

/**
 * Property-level defaults declared by the user-property meta-schema
 * (`api/openapi/endpoints/schemas/user-property.json`). A property that
 * spells one of these out is semantically identical to one that omits it.
 */
export const USER_PROPERTY_DEFAULTS: Readonly<Record<string, boolean>> = {
  "x-editable": true,
  "x-sensitive": false,
};

/**
 * Keys of the flow-definition detail envelope. `fetch` in the flow syncer
 * already unwraps the envelope; stripping them here as well makes the
 * normalizer safe on raw detail responses.
 */
const FLOW_ENVELOPE_KEYS = ["id", "project_id", "schema_uri", "created_at", "updated_at"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An `audience` counts as empty when it scopes nothing: no keys, or only
 * `team_ids`/`app_ids` that are null or empty arrays. Unknown keys keep
 * the audience — better a noisy diff than a silently dropped scope.
 */
function isEmptyAudience(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, entry]) =>
      (key === "team_ids" || key === "app_ids") &&
      (entry === null || entry === undefined || (Array.isArray(entry) && entry.length === 0)),
  );
}

/**
 * Return a deep copy of a bare flow-definition body with server-echoed
 * noise removed: an empty `audience` and any detail-envelope keys. A
 * top-level `$schema` is stripped too — it is a local editor affordance
 * (scaffolded flow files point it at `.zitadel/meta/flow-definition.json`),
 * never part of the resource: the server skips it on decode and omits it
 * from responses, so comparing with it would read every scaffolded file
 * as permanently diverged.
 */
export function normalizeFlowBody(body: object): object {
  const result = structuredClone(body) as Record<string, unknown>;
  for (const key of FLOW_ENVELOPE_KEYS) {
    delete result[key];
  }
  delete result.$schema;
  if ("audience" in result && isEmptyAudience(result.audience)) {
    delete result.audience;
  }
  return result;
}

/**
 * Return a deep copy of a user-schema body with meta-schema property
 * defaults stripped: a property carrying `"x-editable": true` (or the
 * other {@link USER_PROPERTY_DEFAULTS}) normalizes to one omitting it.
 * Only exact default values are removed; `$id` and every other field
 * pass through untouched.
 */
export function normalizeSchemaBody(body: object): object {
  const result = structuredClone(body) as Record<string, unknown>;
  if (!isPlainObject(result.properties)) {
    return result;
  }
  for (const property of Object.values(result.properties)) {
    if (!isPlainObject(property)) {
      continue;
    }
    for (const [key, defaultValue] of Object.entries(USER_PROPERTY_DEFAULTS)) {
      if (property[key] === defaultValue) {
        delete property[key];
      }
    }
  }
  return result;
}
