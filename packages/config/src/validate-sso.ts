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
  /**
   * The flow steps the issue is about, when it is about steps. One issue covers
   * every step with the same problem, so a mistake made on four steps is one
   * line to read and one fix to make.
   */
  readonly steps?: readonly string[];
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

/** `step "a"`, or `steps "a", "b"` when several have the same problem. */
const stepsText = (steps: readonly string[]) =>
  steps.length === 1 ? `step ${q(steps[0] as string)}` : `steps ${steps.map(q).join(", ")}`;

/** Whether a connection lets a provider create users, which decides what a step must route. */
const createsUsers = (connection: Json | undefined) =>
  !isObject(connection?.provisioning) || connection.provisioning.creation !== "disabled";

/** Validate the SSO configuration across files. Pure: collects every issue, never throws. */
export function validateSsoConfiguration(tree: SsoConfigurationTree): SsoIssue[] {
  const issues: SsoIssue[] = [];
  const add = (issue: SsoIssue) => issues.push(issue);

  // A mistake made on several steps is one cause. Steps are gathered under the
  // rule, file and subject they share, and each group becomes one issue.
  const groups = new Map<
    string,
    {
      rule: SsoRuleId;
      file: string;
      steps: string[];
      message: (steps: readonly string[]) => string;
    }
  >();
  const onStep = (
    rule: SsoRuleId,
    file: string,
    subject: string,
    step: string,
    message: (steps: readonly string[]) => string,
  ) => {
    const key = JSON.stringify([rule, file, subject]);
    const group = groups.get(key) ?? { rule, file, steps: [], message };
    group.steps.push(step);
    groups.set(key, group);
  };

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
          message: `sso.providers lists ${q(slug)} but there is no connection file with that slug under .zitadel/idps/. Add the file, or remove ${q(slug)} from sso.providers.`,
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
        // A step must route what a provider can return. A provider that never
        // creates users never returns an unknown identity, so for a step that
        // offers only such providers `sso_authenticated` is all it can get.
        const creates = step.providers.some((slug) =>
          createsUsers(connectionBySlug.get(slug)?.body),
        );
        const missing = (creates ? SSO_OUTCOMES : (["sso_authenticated"] as const)).filter(
          (outcome) => !step.routes.has(outcome),
        );
        if (missing.length > 0) {
          onStep(
            "sso/outcome-routing",
            path,
            missing.join(),
            step.name,
            (steps) =>
              `${stepsText(steps)}: offers sso_providers but does not route ${missing.join(", ")}. Add a transition for each.`,
          );
        }
      }
      if (step.onSuccess === "create_user_with_sso" && !step.routes.has("user_already_exists")) {
        onStep(
          "sso/collection-conflict-routing",
          path,
          "",
          step.name,
          (steps) =>
            `${stepsText(steps)}: on_success create_user_with_sso must route user_already_exists. Add that transition.`,
        );
      }

      for (const slug of step.providers) {
        if (!connectionBySlug.has(slug)) {
          onStep(
            "sso/connection-resolves",
            path,
            slug,
            step.name,
            (steps) =>
              `${stepsText(steps)}: sso provider ${q(slug)} has no connection file with that slug under .zitadel/idps/. Add the file, or remove the provider from the flow.`,
          );
        }
      }

      // Rules that pair the step with the schema its flow pins.
      if (schema === undefined || sso === undefined || schemaPath === undefined) {
        continue;
      }
      if (step.providers.length > 0 && !sso.enabled) {
        onStep(
          "sso/flow-enables-sso",
          path,
          "",
          step.name,
          (steps) =>
            `${stepsText(steps)}: offers sso_providers but "sso" is not an enabled authentication method in ${schemaPath}. Enable it there, or remove sso_providers.`,
        );
      }
      for (const slug of step.providers) {
        if (sso.enabled && !sso.providers.includes(slug)) {
          onStep(
            "sso/provider-id",
            path,
            slug,
            step.name,
            (steps) =>
              `${stepsText(steps)}: sso provider ${q(slug)} is not listed in sso.providers of ${schemaPath}. Add it there, or remove it from the flow.`,
          );
        }
        const connection = connectionBySlug.get(slug);
        // A provider that only signs people in fills no user, so what it maps
        // does not matter.
        if (connection === undefined || !createsUsers(connection.body)) {
          continue;
        }
        const mapped = Object.keys(
          isObject(connection.body.claim_mapping) ? connection.body.claim_mapping : {},
        );
        if (!mapped.some((key) => hasProperty(schema, key))) {
          onStep(
            "sso/empty-claim-mapping",
            path,
            slug,
            step.name,
            (steps) =>
              `${stepsText(steps)}: claim_mapping of ${q(slug)} (${connection.path}) ${
                mapped.length === 0 ? "is empty" : `maps nothing ${schemaPath} defines`
              }, so no sign-in can fill the user. Map at least one property of ${schemaPath} in ${connection.path}.`,
          );
        }
      }
    }
  }
  for (const { rule, file, steps, message } of groups.values()) {
    add({ rule, file, steps, message: message(steps) });
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
          message: `verified_claims key ${q(key)} has no claim_mapping entry, so the claim is never read. Add ${q(key)} to claim_mapping, or remove it from verified_claims.`,
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
          message: `claim_mapping target ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers. Fix the name, or remove the row.`,
        });
      }
    }
    for (const key of verified) {
      if (!referencing.some((schema) => hasProperty(schema, key))) {
        add({
          rule: "sso/orphaned-verification-key",
          file: path,
          message: `verified_claims key ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers, so it can never verify. Fix the name, or remove it.`,
        });
      }
    }
  }

  return issues;
}
