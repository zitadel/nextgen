/**
 * Cross-file SSO rules, for `plan` and `apply`.
 *
 * Single-file validation (`idp-connection.json`, the schema and flow
 * dialects) cannot see that a flow step offers a provider its user schema does
 * not list, or that a schema lists a provider that has no connection file.
 * Those mistakes only show up when the files are read together, so this
 * validator takes the whole working tree: every user schema, every flow and
 * every connection under `.zitadel/idps/`.
 *
 * Every rule here is an error, and every message names the file and, where it
 * applies, the step and the slug or key at fault. They are CLI-only for now:
 * the server mirror of the flow-to-schema rules is #1014, and the
 * connection-to-schema rules need the whole tree, which only the CLI has.
 *
 * Warning-grade rules (missing mapping targets in some schemas, typo guards,
 * provisioning pairings) are #1083. State-dependent rules (slug changes,
 * identity-critical revisions, missing variables, literal secrets) are #1043.
 */

export type SsoRuleId =
  | "sso/flow-enables-sso"
  | "sso/provider-id"
  | "sso/connection-resolves"
  | "sso/outcome-routing"
  | "sso/collection-conflict-routing"
  | "sso/empty-claim-mapping"
  | "sso/unmapped-verification-key"
  | "sso/orphaned-mapping-target"
  | "sso/orphaned-verification-key";

export type SsoIssue = {
  readonly rule: SsoRuleId;
  /** Project-relative path of the file the issue is in. */
  readonly file: string;
  /** The flow step the issue is anchored to, when it is about one. */
  readonly step?: string;
  readonly message: string;
};

/** What the validator reads: the whole working tree, keyed by project-relative path. */
export type SsoConfigurationTree = {
  /** Every user schema. */
  readonly schemas: ReadonlyMap<string, object>;
  /**
   * Every flow, with the path of the schema its `user_schema` pins when that
   * could be worked out. A flow whose schema is unknown still gets the rules
   * that need no schema.
   */
  readonly flows: ReadonlyMap<string, { readonly body: object; readonly schemaPath?: string }>;
  /** Every connection under `.zitadel/idps/`. */
  readonly connections: ReadonlyMap<string, object>;
};

/** Outcomes a step offering providers must route. `sso_authenticated` is the one the engine also requires. */
const SSO_OUTCOMES = ["sso_authenticated", "sso_user_not_found", "user_already_exists"] as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const q = (value: string) => JSON.stringify(value);

/** The providers a schema lists and whether it turns SSO on. */
function schemaSso(schema: object): { enabled: boolean; providers: string[] } {
  const methods = (schema as Json)["x-auth-methods"];
  const sso = isObject(methods) && isObject(methods.sso) ? methods.sso : {};
  return { enabled: sso.enabled === true, providers: strings(sso.providers) };
}

/**
 * Whether a schema defines a property, by the name a mapping uses for it.
 * A dotted name walks into nested objects (`address.street`).
 */
function hasProperty(schema: object, name: string): boolean {
  let level: unknown = (schema as Json).properties;
  for (const part of name.split(".")) {
    if (!isObject(level) || !Object.hasOwn(level, part)) {
      return false;
    }
    const property = level[part];
    level = isObject(property) ? property.properties : undefined;
  }
  return true;
}

type Step = {
  name: string;
  providers: string[];
  onSuccess: string | undefined;
  routes: ReadonlySet<string>;
};

function stepsOf(flow: object): Step[] {
  const raw = (flow as Json).steps;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isObject).map((step) => ({
    name: typeof step.name === "string" ? step.name : "",
    providers: strings(step.sso_providers),
    onSuccess: typeof step.on_success === "string" ? step.on_success : undefined,
    routes: new Set(isObject(step.transitions) ? Object.keys(step.transitions) : []),
  }));
}

/** Validate the SSO configuration across files. Pure: collects every issue, never throws. */
export function validateSsoConfiguration(tree: SsoConfigurationTree): SsoIssue[] {
  const issues: SsoIssue[] = [];
  const add = (issue: SsoIssue) => issues.push(issue);

  // A slug names one connection. Duplicates are the syncer's concern (#1043);
  // the first file in path order stands for the slug here.
  const connectionBySlug = new Map<string, { path: string; body: Json }>();
  for (const [path, body] of [...tree.connections].sort(([a], [b]) => a.localeCompare(b))) {
    const slug = (body as Json).slug;
    if (typeof slug === "string" && !connectionBySlug.has(slug)) {
      connectionBySlug.set(slug, { path, body: body as Json });
    }
  }

  // Schema to connection files: every provider a schema lists must exist.
  for (const [path, schema] of tree.schemas) {
    for (const slug of schemaSso(schema).providers) {
      if (!connectionBySlug.has(slug)) {
        add({
          rule: "sso/connection-resolves",
          file: path,
          message: `sso.providers lists ${q(slug)} but there is no connection file with that slug under .zitadel/idps/`,
        });
      }
    }
  }

  for (const [path, { body, schemaPath }] of tree.flows) {
    const schema = schemaPath === undefined ? undefined : tree.schemas.get(schemaPath);
    const sso = schema === undefined ? undefined : schemaSso(schema);

    for (const step of stepsOf(body)) {
      // Rules that need no schema.
      if (step.providers.length > 0) {
        const missing = SSO_OUTCOMES.filter((outcome) => !step.routes.has(outcome));
        if (missing.length > 0) {
          add({
            rule: "sso/outcome-routing",
            file: path,
            step: step.name,
            message: `step ${q(step.name)}: offers sso_providers but does not route ${missing.join(", ")}`,
          });
        }
      }
      if (step.onSuccess === "create_user_with_sso" && !step.routes.has("user_already_exists")) {
        add({
          rule: "sso/collection-conflict-routing",
          file: path,
          step: step.name,
          message: `step ${q(step.name)}: on_success create_user_with_sso must route user_already_exists`,
        });
      }

      for (const slug of step.providers) {
        if (!connectionBySlug.has(slug)) {
          add({
            rule: "sso/connection-resolves",
            file: path,
            step: step.name,
            message: `step ${q(step.name)}: sso provider ${q(slug)} has no connection file with that slug under .zitadel/idps/`,
          });
        }
      }

      // Rules that pair the step with the schema its flow pins.
      if (schema === undefined || sso === undefined || schemaPath === undefined) {
        continue;
      }
      if (step.providers.length > 0 && !sso.enabled) {
        add({
          rule: "sso/flow-enables-sso",
          file: path,
          step: step.name,
          message: `step ${q(step.name)}: offers sso_providers but "sso" is not an enabled authentication method in ${schemaPath}`,
        });
      }
      for (const slug of step.providers) {
        if (sso.enabled && !sso.providers.includes(slug)) {
          add({
            rule: "sso/provider-id",
            file: path,
            step: step.name,
            message: `step ${q(step.name)}: sso provider ${q(slug)} is not listed in sso.providers of ${schemaPath}`,
          });
        }
        const connection = connectionBySlug.get(slug);
        if (connection === undefined) {
          continue;
        }
        const mapped = Object.keys(
          isObject(connection.body.claim_mapping) ? connection.body.claim_mapping : {},
        );
        if (!mapped.some((key) => hasProperty(schema, key))) {
          add({
            rule: "sso/empty-claim-mapping",
            file: path,
            step: step.name,
            message: `step ${q(step.name)}: claim_mapping of ${q(slug)} (${connection.path}) shares no property with ${schemaPath}, so no sign-in can fill the user`,
          });
        }
      }
    }
  }

  // Connection to schemas. A connection counts as used when a schema lists it
  // or a flow step offers it; the targets of its mappings are judged against
  // the schemas that list it, because only those consume the mapping.
  const offered = new Set<string>();
  for (const { body } of tree.flows.values()) {
    for (const step of stepsOf(body)) {
      for (const slug of step.providers) {
        offered.add(slug);
      }
    }
  }
  for (const [slug, { path, body }] of connectionBySlug) {
    const referencing = [...tree.schemas.values()].filter((schema) =>
      schemaSso(schema).providers.includes(slug),
    );
    const mapping = isObject(body.claim_mapping) ? Object.keys(body.claim_mapping) : [];
    const verified = isObject(body.verified_claims) ? Object.keys(body.verified_claims) : [];

    if (referencing.length === 0 && !offered.has(slug)) {
      continue;
    }
    for (const key of verified) {
      if (!mapping.includes(key)) {
        add({
          rule: "sso/unmapped-verification-key",
          file: path,
          message: `verified_claims key ${q(key)} has no claim_mapping entry, so the claim is never read`,
        });
      }
    }
    if (referencing.length === 0) {
      continue;
    }
    for (const key of mapping) {
      if (!referencing.some((schema) => hasProperty(schema, key))) {
        add({
          rule: "sso/orphaned-mapping-target",
          file: path,
          message: `claim_mapping target ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers`,
        });
      }
    }
    for (const key of verified) {
      if (!referencing.some((schema) => hasProperty(schema, key))) {
        add({
          rule: "sso/orphaned-verification-key",
          file: path,
          message: `verified_claims key ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers, so it can never verify`,
        });
      }
    }
  }

  return issues;
}
