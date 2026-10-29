/**
 * Cross-file SSO rules, for `deploy`.
 *
 * Single-file validation (`idp-connection.json`, the schema and flow
 * dialects) cannot see that a flow step offers a provider its user schema does
 * not list, or that a schema lists a provider that has no connection file.
 * Those mistakes only show up when the files are read together, so this
 * validator takes the whole working tree: every user schema, every flow and
 * every connection under `.zitadel/idps/`.
 *
 * Every rule here is an error, and every message names the file and, where it
 * applies, the steps and the slug or key at fault, and what to change. They are
 * CLI-only for now: the server mirror of the flow-to-schema rules is #1014, and
 * the connection-to-schema rules need the whole tree, which only the CLI has.
 *
 * Warning-grade rules (missing mapping targets in some schemas, typo guards,
 * provisioning pairings) are #1083. The rules that need the platform (identity
 * edits, missing variables) live in the connection syncer, which can read it.
 */

import idpConnectionMetaSchema from "../../meta-schemas/idp-connection.json" with { type: "json" };
import { IDP_PROVIDERS } from "../idp/index.js";
import { referencedVariable } from "../idp/provider.js";
import { standardClaim, type ClaimType } from "../idp/standard-claims.js";
import type { ProjectRuleId } from "./rules.js";
import type { ProjectIssue, ProjectTree } from "./types.js";

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
 *
 * One top-level property name, as the engine reads it: a name cannot hold a dot
 * and a value is not addressable inside a nested object, so `address.street`
 * names nothing and the engine drops the claim at sign-in.
 */
function hasProperty(schema: object, name: string): boolean {
  const properties = (schema as Json).properties;
  return isObject(properties) && Object.hasOwn(properties, name);
}

/** "a" or "an" before a type name. */
const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");

/** The JSON types a schema property may declare for a claim of this type to fit it. */
const FITS: Readonly<Record<ClaimType, readonly string[]>> = {
  string: ["string"],
  boolean: ["boolean"],
  number: ["number", "integer"],
  object: ["object"],
};

/**
 * The types a schema property declares, or `undefined` when it declares none
 * (it then accepts anything, so nothing can be said against it).
 */
function declaredTypes(schema: object, name: string): string[] | undefined {
  const properties = (schema as Json).properties;
  const definition = isObject(properties) ? properties[name] : undefined;
  const type = isObject(definition) ? definition.type : undefined;
  if (typeof type === "string") {
    return [type];
  }
  return Array.isArray(type) && type.length > 0 ? strings(type) : undefined;
}

/** The field names the connection contract allows at the top and in each block that forbids extras. */
function allowedFields(path: readonly string[]): string[] {
  let level: unknown = idpConnectionMetaSchema;
  for (const key of path) {
    level = isObject(level) && isObject(level.properties) ? level.properties[key] : undefined;
  }
  return isObject(level) && level.additionalProperties === false && isObject(level.properties)
    ? Object.keys(level.properties)
    : [];
}

/** The scopes OpenID Connect itself defines, which return only the standard claims. */
const STANDARD_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "address",
  "phone",
  "offline_access",
]);

/** Names that are not standard claims but are, wherever they appear, an account name a user can change. */
const MUTABLE_SUBJECTS = new Set(["login", "username"]);

/** A Unicode space at either end of a name: the set Go's strings.TrimSpace trims, so both sides agree. */
const EDGE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;

/** Edit distance between two names, for telling a typo from a different name. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/**
 * The one property a mistyped name most likely meant, as a sentence to put in
 * a message, or an empty string when nothing is close enough to be worth
 * saying. A different case, or a name one or two edits away (a name of four
 * characters or fewer tolerates one), counts; the closest wins and a tie
 * names nothing, because guessing between two is no help.
 */
function didYouMean(name: string, candidates: Iterable<string>): string {
  // A name of one or two characters is as close to a dozen others as to the
  // one meant, so a guess would be noise.
  if (name.length < 3) {
    return "";
  }
  const allowed = name.length <= 4 ? 1 : 2;
  let best: { candidate: string; cost: number } | undefined;
  let tied = false;
  for (const candidate of new Set(candidates)) {
    if (candidate === name) {
      continue;
    }
    const cost = candidate.toLowerCase() === name.toLowerCase() ? 0 : distance(name, candidate);
    if (cost > allowed) {
      continue;
    }
    if (best === undefined || cost < best.cost) {
      best = { candidate, cost };
      tied = false;
    } else if (cost === best.cost) {
      tied = true;
    }
  }
  return best === undefined || tied ? "" : ` Did you mean ${q(best.candidate)}?`;
}

/** The names of every property the given schemas define. */
function propertyNames(schemas: readonly object[]): string[] {
  return schemas.flatMap((schema) => {
    const properties = (schema as Json).properties;
    return isObject(properties) ? Object.keys(properties) : [];
  });
}

type Step = {
  name: string;
  fields: string[];
  providers: string[];
  onSuccess: string | undefined;
  routes: ReadonlySet<string>;
  /** Whether `user_already_exists` is there but carries an action, which the engine does not follow. */
  collisionNeedsNoAction: boolean;
};

function stepsOf(flow: object): Step[] {
  const raw = (flow as Json).steps;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isObject).map((step) => ({
    name: typeof step.name === "string" ? step.name : "",
    fields: strings(step.fields),
    providers: strings(step.sso_providers),
    onSuccess: typeof step.on_success === "string" ? step.on_success : undefined,
    routes: new Set(routedOutcomes(step.transitions)),
    collisionNeedsNoAction:
      isObject(step.transitions) &&
      "user_already_exists" in step.transitions &&
      !routedOutcomes(step.transitions).includes("user_already_exists"),
  }));
}

/**
 * The outcomes a step routes. The engine follows an SSO collision only through
 * a `user_already_exists` transition that has no action: one that switches or
 * pivots to another flow leaves the step showing the SSO error instead.
 */
function routedOutcomes(transitions: unknown): string[] {
  if (!isObject(transitions)) {
    return [];
  }
  return Object.entries(transitions)
    .filter(
      ([outcome, route]) =>
        outcome !== "user_already_exists" ||
        !isObject(route) ||
        route.action === undefined ||
        route.action === null,
    )
    .map(([outcome]) => outcome);
}

/** `step "a"`, or `steps "a", "b"` when several have the same problem. */
const stepsText = (steps: readonly string[]) =>
  steps.length === 1 ? `step ${q(steps[0] as string)}` : `steps ${steps.map(q).join(", ")}`;

/** Whether a connection lets a provider create users, which decides what a step must route. */
const createsUsers = (connection: Json | undefined) =>
  !isObject(connection?.provisioning) || connection.provisioning.creation !== "disabled";

/** The catalog provider ids a connection's `template` may name. */
const CATALOG_TEMPLATES = new Set<string>(IDP_PROVIDERS);

/**
 * Whether a connection was scaffolded from a catalog provider, which its
 * `template` names. A catalog connection's scopes are vendor knowledge, so a
 * missing scope is an error; a custom connection's are the developer's to get
 * right, so it is only a warning.
 */
const isCatalog = (body: Json): boolean =>
  typeof body.template === "string" && CATALOG_TEMPLATES.has(body.template);

/** The SSO rules: schemas, flows and connection files read together. */
export function ssoRules(tree: ProjectTree): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const add = (issue: Omit<ProjectIssue, "severity"> & { severity?: ProjectIssue["severity"] }) =>
    issues.push({ ...issue, severity: issue.severity ?? "error" });

  // A mistake made on several steps is one cause. Steps are gathered under the
  // rule, file and subject they share, and each group becomes one issue.
  const groups = new Map<
    string,
    {
      rule: ProjectRuleId;
      file: string;
      steps: string[];
      slug?: string;
      message: (steps: readonly string[]) => string;
    }
  >();
  const onStep = (
    rule: ProjectRuleId,
    file: string,
    subject: string,
    step: string,
    message: (steps: readonly string[]) => string,
    slug?: string,
  ) => {
    const key = JSON.stringify([rule, file, subject]);
    const group = groups.get(key) ?? { rule, file, steps: [], message, ...(slug ? { slug } : {}) };
    group.steps.push(step);
    groups.set(key, group);
  };

  // A slug names one connection, so two files claiming it cannot both be
  // synced. The first file in path order stands for the slug in the rules below.
  const connectionBySlug = new Map<string, { path: string; body: Json }>();
  for (const [path, body] of [...tree.connections].sort(([a], [b]) => a.localeCompare(b))) {
    const slug = (body as Json).slug;
    if (typeof slug !== "string") {
      continue;
    }
    const first = connectionBySlug.get(slug);
    if (first === undefined) {
      connectionBySlug.set(slug, { path, body: body as Json });
    } else {
      add({
        rule: "sso/duplicate-slug",
        file: path,
        message: `connection slug ${q(slug)} is also used by ${first.path}. A slug names one connection: change the slug here, or delete one of the two files.`,
      });
    }
  }

  // Two connections that name the same project variable would share a
  // credential, and publishing one overwrites the other.
  const variableOwner = new Map<string, { path: string; field: string }>();
  for (const [path, body] of [...tree.connections].sort(([a], [b]) => a.localeCompare(b))) {
    const block = (body as Json).oidc;
    for (const field of ["client_id", "client_secret"] as const) {
      const value = isObject(block) ? block[field] : undefined;
      const name = typeof value === "string" ? referencedVariable(value) : undefined;
      if (name === undefined) {
        continue;
      }
      const owner = variableOwner.get(name);
      if (owner === undefined) {
        variableOwner.set(name, { path, field });
      } else if (owner.path !== path) {
        add({
          rule: "sso/shared-variable",
          file: path,
          message: `${field} names the variable ${name}, which ${owner.path} also uses (as its ${owner.field}). Give each connection its own variable so one cannot overwrite the other.`,
        });
      }
    }
  }

  // Schema to connection files: every provider a schema lists must exist,
  // and be listed once.
  for (const [path, schema] of tree.schemas) {
    const listed = schemaSso(schema).providers;
    for (const slug of new Set(listed.filter((name, at) => listed.indexOf(name) !== at))) {
      add({
        rule: "sso/duplicate-provider",
        file: path,
        slug,
        message: `sso.providers lists ${q(slug)} more than once. List each provider once.`,
      });
    }
    for (const slug of new Set(listed)) {
      if (!connectionBySlug.has(slug)) {
        add({
          rule: "sso/connection-resolves",
          file: path,
          slug,
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
      for (const slug of new Set(
        step.providers.filter((name, at) => step.providers.indexOf(name) !== at),
      )) {
        onStep(
          "sso/duplicate-provider",
          path,
          slug,
          step.name,
          (steps) =>
            `${stepsText(steps)}: sso_providers lists ${q(slug)} more than once, which offers its button twice. List each provider once.`,
        );
      }
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
              `${stepsText(steps)}: offers sso_providers but does not route ${missing.join(", ")}. ${
                step.collisionNeedsNoAction && missing.includes("user_already_exists")
                  ? "A collision is followed only through a user_already_exists transition with no action, so remove its action. Add a transition for the rest."
                  : "Add a transition for each."
              }`,
          );
        }
      }
      if (step.onSuccess === "create_user_with_sso" && !step.routes.has("user_already_exists")) {
        onStep(
          "sso/collection-conflict-routing",
          path,
          String(step.collisionNeedsNoAction),
          step.name,
          (steps) =>
            step.collisionNeedsNoAction
              ? `${stepsText(steps)}: on_success create_user_with_sso must route user_already_exists, and an SSO collision is followed only through a transition with no action. Remove the action from it.`
              : `${stepsText(steps)}: on_success create_user_with_sso must route user_already_exists. Add that transition.`,
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
            slug,
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

  // The step that creates a user from a sign-in asks for what the claims did
  // not supply. A required property that neither the step asks for nor every
  // provider maps leaves a user the schema would refuse, whichever provider
  // the person signed in with.
  for (const [path, { body, schemaPath }] of tree.flows) {
    const schema = schemaPath === undefined ? undefined : tree.schemas.get(schemaPath);
    if (schema === undefined) {
      continue;
    }
    const steps = stepsOf(body);
    const mappers = [...new Set(steps.flatMap((step) => step.providers))]
      .map((slug) => connectionBySlug.get(slug))
      .filter((connection) => connection !== undefined && createsUsers(connection.body))
      .map((connection) =>
        Object.keys(
          isObject(connection?.body.claim_mapping) ? (connection.body.claim_mapping as Json) : {},
        ),
      );
    // The identifier is how the person signs in again, so a user created
    // without it is as unusable as one missing a required property.
    const identifier = (schema as Json)["x-identifier"];
    const passwordSignIn = isObject((schema as Json)["x-auth-methods"])
      ? isObject(((schema as Json)["x-auth-methods"] as Json).password) &&
        (((schema as Json)["x-auth-methods"] as Json).password as Json).enabled === true
      : false;
    // Named by the top-level property, as a mapping and a step's fields are.
    const required = [
      ...new Set(
        [
          ...strings((schema as Json).required),
          // Only a password asks for the identifier again; a passkey or an
          // SSO sign-in does not, so it is no reason to collect one.
          ...(passwordSignIn && typeof identifier === "string" && identifier !== ""
            ? [identifier]
            : []),
        ].map((name) => name.split(".")[0] as string),
      ),
    ];
    for (const step of steps.filter(
      (candidate) => candidate.onSuccess === "create_user_with_sso",
    )) {
      const asked = new Set(step.fields.map((field) => field.split(".")[0]));
      const missing = required.filter(
        (name) => !asked.has(name) && !mappers.every((mapped) => mapped.includes(name)),
      );
      if (missing.length > 0) {
        onStep(
          "sso/collection-misses-required",
          path,
          missing.join(),
          step.name,
          (named) =>
            `${stepsText(named)}: on_success create_user_with_sso creates a user without ${missing.map(q).join(", ")}, which ${schemaPath} requires (or signs people in by) and not every provider maps. Add ${missing.length === 1 ? "it" : "them"} to fields, or map ${missing.length === 1 ? "it" : "them"} from each provider.`,
        );
      }
    }
  }

  for (const { rule, file, steps, message, slug } of groups.values()) {
    add({ rule, file, steps, ...(slug ? { slug } : {}), message: message(steps) });
  }

  // Connection to schemas. A connection counts as used when a schema lists it
  // or a flow step offers it; the targets of its mappings are judged against
  // the schemas that list it, because only those consume the mapping.
  for (const [slug, { path, body }] of connectionBySlug) {
    const referencing = [...tree.schemas.values()].filter((schema) =>
      schemaSso(schema).providers.includes(slug),
    );
    const mapping = isObject(body.claim_mapping) ? Object.keys(body.claim_mapping) : [];
    const verified = isObject(body.verified_claims) ? Object.keys(body.verified_claims) : [];

    // A field the contract does not have is dropped without a word by the
    // client and refused by the server, so a misspelt section would lose a
    // mapping silently on one side and fail on apply on the other.
    for (const block of [[], ["oidc"], ["provisioning"]] as const) {
      const allowed = allowedFields(block);
      const value = block.length === 0 ? body : (body as Json)[block[0] as string];
      if (allowed.length === 0 || !isObject(value)) {
        continue;
      }
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          const where = block.length === 0 ? "a connection" : `the ${block[0]} block`;
          add({
            rule: "sso/unknown-connection-field",
            file: path,
            message: `${q(key)} is not a field of ${where}, so it is ignored or refused.${didYouMean(key, allowed)} Fix the name, or remove it.`,
          });
        }
      }
    }
    const unreadable = (key: string) =>
      referencing.length > 0 && !referencing.some((schema) => hasProperty(schema, key));
    for (const key of verified) {
      if (!mapping.includes(key) && !unreadable(key)) {
        add({
          rule: "sso/unmapped-verification-key",
          file: path,
          message: `verified_claims key ${q(key)} has no claim_mapping entry, so the claim is never read. Add ${q(key)} to claim_mapping, or remove it from verified_claims.`,
        });
      }
    }
    // What the provider is asked for decides which standard claims arrive, so
    // this needs no schema: a connection a flow offers is judged the same.
    const scopes =
      isObject(body.oidc) && Array.isArray(body.oidc.scopes)
        ? strings(body.oidc.scopes)
        : undefined;
    const stringValues = (value: unknown): string[] =>
      isObject(value) ? Object.values(value).filter((v): v is string => typeof v === "string") : [];
    const reads = [
      ...stringValues(body.claim_mapping).map((claim) => ({ field: "claim_mapping", claim })),
      ...stringValues(body.verified_claims).map((claim) => ({ field: "verified_claims", claim })),
    ];
    // A scope the standard does not define may bundle claims (a directory scope
    // that returns the email), so only a list of standard scopes alone can be
    // said to leave a claim out.
    if (scopes !== undefined && scopes.every((scope) => STANDARD_SCOPES.has(scope))) {
      const missingScope = new Map<string, { field: string; scope: string; claims: Set<string> }>();
      for (const { field, claim } of reads) {
        const standard = standardClaim(claim);
        if (standard !== undefined && !scopes.includes(standard.scope)) {
          const key = `${field}\0${standard.scope}`;
          const entry = missingScope.get(key) ?? {
            field,
            scope: standard.scope,
            claims: new Set(),
          };
          entry.claims.add(claim);
          missingScope.set(key, entry);
        }
      }
      // A catalog provider's scopes are vendor knowledge the CLI scaffolded, so
      // a missing one is an error; a custom connection's are the developer's, so
      // it only warns and `deploy` carries on.
      const scopeSeverity: ProjectIssue["severity"] = isCatalog(body) ? "error" : "warning";
      for (const { field, scope, claims } of missingScope.values()) {
        add({
          rule: "sso/claim-needs-scope",
          file: path,
          severity: scopeSeverity,
          message: `${field} reads ${[...claims].map(q).join(", ")}, which a provider only returns for the ${q(scope)} scope, and oidc.scopes is ${scopes.map(q).join(", ")}. Add ${q(scope)} to oidc.scopes, or read another claim.`,
        });
      }
    }
    for (const [key, source] of Object.entries(
      isObject(body.verified_claims) ? body.verified_claims : {},
    )) {
      const standard = typeof source === "string" ? standardClaim(source) : undefined;
      if (typeof source === "string" && standard !== undefined && standard.type !== "boolean") {
        add({
          rule: "sso/verification-source-not-boolean",
          file: path,
          message: `verified_claims reads ${q(source)} to verify ${q(key)}, but that is ${article(standard.type)} ${standard.type} claim, not one that says whether a value is verified, so it never verifies. Read the claim the provider sends for that (such as "email_verified").`,
        });
      }
    }
    // A claim name is matched exactly, so a space around it names a claim no
    // provider sends. The subject is what identity keys on, so it has to be
    // a value that never changes: a standard claim other than `sub` is a
    // profile fact (an email, a name) that the user can change.
    const claimNames = [
      ...reads.map(({ field, claim }) => ({ field, claim })),
      ...(typeof body.subject_claim === "string"
        ? [{ field: "subject_claim", claim: body.subject_claim }]
        : []),
    ];
    for (const { field, claim } of claimNames) {
      if (EDGE_SPACE.test(claim)) {
        add({
          rule: "sso/claim-name-whitespace",
          file: path,
          message: `${field} names ${q(claim)}, which has a space at its start or end, so no provider sends a claim by that name. Remove the space.`,
        });
      }
    }
    if (
      typeof body.subject_claim === "string" &&
      (standardClaim(body.subject_claim) !== undefined || MUTABLE_SUBJECTS.has(body.subject_claim))
    ) {
      add({
        rule: "sso/subject-claim-unstable",
        file: path,
        message: `subject_claim is ${q(body.subject_claim)}, a profile claim the user can change, and identity keys on the subject, so a change would sign them in as a stranger. Use a claim that never changes: "sub", or a provider-specific one such as "oid".`,
      });
    }
    if (referencing.length === 0) {
      continue;
    }
    for (const [key, claim] of Object.entries(
      isObject(body.claim_mapping) ? body.claim_mapping : {},
    )) {
      const standard = typeof claim === "string" ? standardClaim(claim) : undefined;
      const defining = referencing.filter((schema) => declaredTypes(schema, key) !== undefined);
      if (
        typeof claim === "string" &&
        standard !== undefined &&
        defining.length > 0 &&
        !defining.some((schema) =>
          (declaredTypes(schema, key) ?? []).some((type) => FITS[standard.type].includes(type)),
        )
      ) {
        const declared = [
          ...new Set(defining.flatMap((schema) => declaredTypes(schema, key) ?? [])),
        ];
        add({
          rule: "sso/claim-type-mismatch",
          file: path,
          message: `claim_mapping reads ${q(claim)}, ${article(standard.type)} ${standard.type} claim, into ${q(key)}, which the schema types as ${declared.join(" or ")}. Read a claim of a matching type, or change the type of ${q(key)}.`,
        });
      }
    }
    // What a mistyped name could have meant: the properties of the schemas
    // that list this connection, less the ones already mapped.
    const nameable = propertyNames(referencing).filter((name) => !mapping.includes(name));
    for (const key of mapping) {
      if (!referencing.some((schema) => hasProperty(schema, key))) {
        add({
          rule: "sso/orphaned-mapping-target",
          file: path,
          message: `claim_mapping target ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers.${didYouMean(key, nameable)} Fix the name, or remove the row.`,
        });
      }
    }
    for (const key of verified) {
      if (!referencing.some((schema) => hasProperty(schema, key))) {
        add({
          rule: "sso/orphaned-verification-key",
          file: path,
          message: `verified_claims key ${q(key)} is not a property of any schema that lists ${q(slug)} in sso.providers, so it can never verify.${didYouMean(key, propertyNames(referencing))} Fix the name, or remove it.`,
        });
      }
    }
  }

  return issues;
}
