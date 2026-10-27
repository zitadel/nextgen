/**
 * Canonical-form normalizers for the repo-config resource kinds.
 *
 * The sync engine compares `.zitadel/**` files against server responses;
 * the server echoes fields the author never wrote (an empty `audience`
 * on flows, a connection's `pkce_enabled`) and leaves out others it holds
 * as defaults (an action's `primary: false`), and the meta-schemas declare
 * defaults an author may or may not spell out (`x-audit` on schema
 * properties). Normalizing both sides before hashing or diffing keeps a
 * one-field edit rendering as a one-field diff, and reads a field the file
 * leaves out as the server's default rather than as a change.
 *
 * Normalized bodies are for COMPARISON; uploads send the file as written,
 * and `apply` never writes a server body back into the file. Comparing
 * without the defaults is sound because the server applies them itself: it
 * decodes a schema into ogen's typed `UserSchema`, which sets `x-audit:
 * false` on every property that omits it, and stores the re-encoded body
 * (`internal/api/schema.go`), so a spelled-out default and an omitted one
 * publish the same revision. `normalize.test.ts` pins every default
 * stripped here to the meta-schema that declares it.
 */

/**
 * Property-level defaults declared by the user-property meta-schema
 * (`api/openapi/endpoints/schemas/user-property.json`). A property that
 * spells one of these out is semantically identical to one that omits it:
 * audit payloads deny by default.
 */
export const USER_PROPERTY_DEFAULTS: Readonly<Record<string, boolean>> = {
  "x-audit": false,
};

/**
 * Step-level defaults declared by the flow-definition meta-schema
 * (`$defs.FlowDefinitionStep` in `api/openapi/endpoints/schemas/flow-definition.json`).
 * The server leaves them out of the definitions it returns.
 */
export const FLOW_STEP_DEFAULTS: Readonly<Record<string, unknown>> = {
  fields: [],
  actions: [],
  gates: {},
  sso_providers: [],
};

/** Action-level defaults declared by the flow-definition meta-schema (`$defs.StepAction`). */
export const STEP_ACTION_DEFAULTS: Readonly<Record<string, unknown>> = {
  primary: false,
};

/**
 * Field defaults declared by the connection meta-schema
 * (`api/openapi/endpoints/schemas/idp-connection.json`), by block. The server
 * stores a connection with the `oidc` ones spelled out, so the stored body and
 * a file that leaves them out describe the same connection. `oidc.scopes` is
 * not one: its `default` is an editor prefill, and the field is required.
 */
export const IDP_CONNECTION_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> =
  {
    oidc: {
      id_token_mapping: false,
      token_endpoint_auth_method: "client_secret_basic",
      pkce_enabled: true,
    },
    provisioning: { creation: "auto" },
  };

/**
 * Keys of the flow-definition response envelope. `fetch` in the flow syncer
 * already unwraps the envelope; stripping them here as well makes the
 * normalizer safe on raw detail responses.
 */
const FLOW_ENVELOPE_KEYS = ["id", "project_id", "created_at", "updated_at"];

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
 * as permanently diverged. Steps and actions lose the
 * {@link FLOW_STEP_DEFAULTS} and {@link STEP_ACTION_DEFAULTS} they spell out,
 * which the server leaves out when it answers.
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
  if (Array.isArray(result.steps)) {
    for (const step of result.steps.filter(isPlainObject)) {
      stripDefaults(step, FLOW_STEP_DEFAULTS);
      if (Array.isArray(step.actions)) {
        for (const action of step.actions.filter(isPlainObject)) {
          stripDefaults(action, STEP_ACTION_DEFAULTS);
        }
      }
    }
  }
  return result;
}

/**
 * Return a deep copy of an identity provider connection body without the
 * {@link IDP_CONNECTION_DEFAULTS} it spells out, so a file that leaves a
 * default to the server and the stored connection that spells it out compare
 * equal. A block that leaves empty (`provisioning: { creation: "auto" }`)
 * goes too, and so does the local-only `$schema` editor pointer, which the
 * platform ignores.
 */
export function normalizeIdpBody(body: object): object {
  const result = structuredClone(body) as Record<string, unknown>;
  delete result.$schema;
  for (const [block, defaults] of Object.entries(IDP_CONNECTION_DEFAULTS)) {
    const value = result[block];
    if (!isPlainObject(value)) {
      continue;
    }
    stripDefaults(value, defaults);
    if (Object.keys(value).length === 0) {
      delete result[block];
    }
  }
  return result;
}

/** Delete every key of `target` that holds exactly its declared default. */
function stripDefaults(
  target: Record<string, unknown>,
  defaults: Readonly<Record<string, unknown>>,
): void {
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (key in target && JSON.stringify(target[key]) === JSON.stringify(defaultValue)) {
      delete target[key];
    }
  }
}

/**
 * Return a deep copy of a user-schema body with meta-schema property
 * defaults stripped: a property carrying one of the
 * {@link USER_PROPERTY_DEFAULTS} normalizes to one omitting it. Only
 * exact default values are removed; `$id` and every other field pass
 * through untouched. Nested `properties` are descended into, so a leaf
 * of an object property normalizes the same way a top-level one does.
 */
export function normalizeSchemaBody(body: object): object {
  const result = structuredClone(body) as Record<string, unknown>;
  stripPropertyDefaults(result);
  return result;
}

/**
 * Strip {@link USER_PROPERTY_DEFAULTS} from every property of an object
 * schema, descending into nested `properties` so a leaf of an object
 * property normalizes the same way a top-level one does.
 */
function stripPropertyDefaults(schema: Record<string, unknown>): void {
  if (!isPlainObject(schema.properties)) {
    return;
  }
  for (const property of Object.values(schema.properties)) {
    if (!isPlainObject(property)) {
      continue;
    }
    for (const [key, defaultValue] of Object.entries(USER_PROPERTY_DEFAULTS)) {
      if (property[key] === defaultValue) {
        delete property[key];
      }
    }
    stripPropertyDefaults(property);
  }
}
