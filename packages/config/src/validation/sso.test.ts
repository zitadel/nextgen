import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema, SETUP_PRESETS, SETUP_USE_CASES } from "../defaults.js";
import { CustomOidcProvider, DEFAULT_SCOPES, GoogleProvider } from "../idp/index.js";
import { displayName, issuer, slug } from "../idp/test-support.js";

import {
  VALIDATION_RULES,
  validateProject,
  type ProjectTree,
  type ProjectRuleId,
} from "./index.js";

/**
 * A project is a plain object so a test can say what is different about it:
 * start from one that is valid, change one thing, and read what comes back.
 */
type Step = {
  name: string;
  fields: string[];
  sso_providers?: string[];
  on_success?: string;
  transitions: Record<string, { target: string }>;
};
type Schema = {
  required?: string[];
  "x-identifier"?: string;
  properties: Record<string, object>;
  "x-auth-methods": {
    sso: { enabled: boolean; providers: string[] };
    password?: { enabled: boolean };
  };
};
type Connection = {
  slug: string;
  template?: string;
  claim_mapping?: Record<string, string>;
  verified_claims?: Record<string, string>;
  provisioning?: { creation: "auto" | "disabled" };
  oidc?: { client_id: string; client_secret: string; scopes?: string[] };
};
type Project = {
  schemas: Record<string, Schema>;
  flows: Record<string, { schemaPath?: string; body: { steps: Step[] } }>;
  connections: Record<string, Connection>;
  /** The connection slugs the server already has. */
  deployed?: string[];
};

const STAFF = ".zitadel/schemas/staff.json";
const PARTNERS = ".zitadel/schemas/partners.json";
const LOGIN = ".zitadel/flows/login.json";
const GOOGLE = ".zitadel/idps/google.json";

const ALL_OUTCOMES = ["sso_authenticated", "sso_user_not_found", "user_already_exists", "submit"];

const aStep = (name: string, over: Partial<Step> = {}, routes = ALL_OUTCOMES): Step => ({
  name,
  fields: ["email"],
  transitions: Object.fromEntries(routes.map((route) => [route, { target: "done" }])),
  ...over,
});

const aSchema = (over: Partial<Schema["x-auth-methods"]["sso"]> = {}, properties = {}): Schema => ({
  properties: { email: {}, ...properties },
  "x-auth-methods": { sso: { enabled: true, providers: ["google"], ...over } },
});

/** A project that agrees with itself: one schema, one flow offering Google, one connection. */
function aProject(): Project {
  return {
    schemas: { [STAFF]: aSchema() },
    flows: {
      [LOGIN]: {
        schemaPath: STAFF,
        body: {
          steps: [
            aStep("identifier", { sso_providers: ["google"] }),
            aStep("register-sso", { on_success: "create_user_with_sso" }),
          ],
        },
      },
    },
    connections: { [GOOGLE]: { slug: "google", claim_mapping: { email: "email" } } },
  };
}

const toTree = (project: Project): ProjectTree => ({
  schemas: new Map(Object.entries(project.schemas)),
  flows: new Map(Object.entries(project.flows)),
  connections: new Map(Object.entries(project.connections)),
  ...(project.deployed ? { deployed: new Set(project.deployed) } : {}),
});

/** The issues for the valid project after `edit` has changed it. */
function validate(edit: (project: Project) => void = () => {}) {
  const project = aProject();
  edit(project);
  return validateProject(toTree(project));
}

/** A step of the login flow, or a failure that says the builder changed. */
function stepOf(project: Project, name: string): Step {
  const step = project.flows[LOGIN]?.body.steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`the project has no ${name} step`);
  }
  return step;
}

const schemaOf = (project: Project, path = STAFF): Schema => {
  const schema = project.schemas[path];
  if (schema === undefined) {
    throw new Error(`the project has no ${path}`);
  }
  return schema;
};

const connectionOf = (project: Project, path = GOOGLE): Connection => {
  const connection = project.connections[path];
  if (connection === undefined) {
    throw new Error(`the project has no ${path}`);
  }
  return connection;
};

type Expected = {
  rule: ProjectRuleId;
  file: string;
  steps?: string[];
  /** The issue's severity, defaulting to the error that most rules are. */
  severity?: "error" | "warning";
  /** Fragments of the message: the name at fault, and the fix. */
  says: string[];
};

/** One rule broken in one way: what to change in the valid project, and what must come back. */
const broken: Array<{ name: string; edit: (project: Project) => void; expect: Expected[] }> = [
  {
    name: "a step offers a provider, and the schema has sso switched off",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso = { enabled: false, providers: [] };
    },
    expect: [
      {
        rule: "sso/flow-enables-sso",
        file: LOGIN,
        steps: ["identifier"],
        says: ["identifier", "not an enabled authentication method", "remove sso_providers"],
      },
    ],
  },
  {
    name: "a step offers google and the schema lists only github",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["github"];
      p.connections[".zitadel/idps/github.json"] = {
        slug: "github",
        claim_mapping: { email: "e" },
      };
    },
    expect: [
      {
        rule: "sso/provider-id",
        file: LOGIN,
        steps: ["identifier"],
        says: ["google", "not listed in sso.providers", "Add it there"],
      },
    ],
  },
  {
    name: "the schema and a step both name google and no connection file has that slug, reported once on the schema",
    edit: (p) => {
      p.connections = {};
    },
    expect: [
      {
        rule: "sso/connection-resolves",
        file: STAFF,
        says: ["sso.providers", "google", "Add the file"],
      },
    ],
  },
  {
    name: "two connection files claim the same slug",
    edit: (p) => {
      p.connections["copy.json"] = structuredClone(connectionOf(p));
    },
    expect: [
      {
        rule: "sso/duplicate-slug",
        file: "copy.json",
        says: ["google", GOOGLE, "one connection"],
      },
    ],
  },
  {
    name: "two connection files name the same variable",
    edit: (p) => {
      connectionOf(p).oidc = {
        client_id: "${{ SHARED_ID }}",
        client_secret: "${{ SHARED_SECRET }}",
      };
      p.connections["other.json"] = { ...structuredClone(connectionOf(p)), slug: "other" };
    },
    expect: [
      {
        rule: "sso/shared-variable",
        file: "other.json",
        says: ["client_id", "also uses", "own variable"],
      },
      {
        rule: "sso/shared-variable",
        file: "other.json",
        says: ["client_secret", "also uses", "own variable"],
      },
    ],
  },
  {
    name: "a step offers a provider and routes only sso_authenticated",
    edit: (p) => {
      stepOf(p, "identifier").transitions = { sso_authenticated: { target: "done" } };
    },
    expect: [
      {
        rule: "sso/outcome-routing",
        file: LOGIN,
        steps: ["identifier"],
        says: ["sso_user_not_found, user_already_exists", "Add a transition"],
      },
    ],
  },
  {
    name: "a step routes user_already_exists only through a switch to another flow",
    edit: (p) => {
      const step = stepOf(p, "identifier");
      step.transitions = {
        ...step.transitions,
        user_already_exists: { target: "done", action: "switch" } as { target: string },
      };
    },
    expect: [
      {
        rule: "sso/outcome-routing",
        file: LOGIN,
        steps: ["identifier"],
        says: ["user_already_exists", "with no action", "remove its action"],
      },
    ],
  },
  {
    name: "the collection step routes user_already_exists only through a switch to another flow",
    edit: (p) => {
      stepOf(p, "register-sso").transitions = {
        submit: { target: "done" },
        user_already_exists: { target: "done", action: "switch" } as { target: string },
      };
    },
    expect: [
      {
        rule: "sso/collection-conflict-routing",
        file: LOGIN,
        steps: ["register-sso"],
        says: ["user_already_exists", "no action", "Remove the action"],
      },
    ],
  },
  {
    name: "the collection step does not route user_already_exists",
    edit: (p) => {
      stepOf(p, "register-sso").transitions = { submit: { target: "done" } };
    },
    expect: [
      {
        rule: "sso/collection-conflict-routing",
        file: LOGIN,
        steps: ["register-sso"],
        says: ["register-sso", "user_already_exists"],
      },
    ],
  },
  {
    name: "the connection maps nothing, so no sign-in can fill the user",
    edit: (p) => {
      connectionOf(p).claim_mapping = {};
    },
    expect: [
      {
        rule: "sso/empty-claim-mapping",
        file: LOGIN,
        steps: ["identifier"],
        says: ["google", "is empty", "Map at least one property"],
      },
    ],
  },
  {
    name: "one typo in the schema's provider list, reported once with the provider it meant",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["googel"];
    },
    expect: [
      {
        rule: "sso/connection-resolves",
        file: STAFF,
        says: ['"googel"', 'Did you mean "google"?'],
      },
    ],
  },
  {
    name: "one typo in a flow step's provider list, reported once with the provider it meant",
    edit: (p) => {
      stepOf(p, "identifier").sso_providers = ["googel"];
    },
    expect: [
      {
        rule: "sso/connection-resolves",
        file: LOGIN,
        steps: ["identifier"],
        says: ['"googel"', 'Did you mean "google"?'],
      },
    ],
  },
  {
    name: "one typo in a mapping target that a verification names, reported once",
    edit: (p) => {
      connectionOf(p).claim_mapping = { emial: "email" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
    expect: [
      {
        rule: "sso/orphaned-mapping-target",
        file: GOOGLE,
        says: ['"emial"', 'Did you mean "email"?'],
      },
    ],
  },
  {
    name: "the connection maps only names the schema does not define, reported once per name",
    edit: (p) => {
      connectionOf(p).claim_mapping = { emailAddress: "mail" };
    },
    expect: [{ rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["emailAddress"] }],
  },
  {
    name: "verified_claims names a key that claim_mapping does not map",
    edit: (p) => {
      schemaOf(p).properties.givenName = {};
      connectionOf(p).verified_claims = { givenName: "given_name_verified" };
    },
    expect: [
      {
        rule: "sso/unmapped-verification-key",
        file: GOOGLE,
        says: ["givenName", "no claim_mapping entry", "remove it from verified_claims"],
      },
    ],
  },
  {
    name: "claim_mapping targets a property no schema defines",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email", emailAddress: "mail" };
    },
    expect: [
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["emailAddress", "Fix the name"] },
    ],
  },
  {
    name: "a mapped, verified key is a property no schema defines",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email", nickname: "nick" };
      connectionOf(p).verified_claims = { nickname: "nick_verified" };
    },
    // A mapped key a schema does not define is both an orphaned target and an orphaned verification key.
    expect: [
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["nickname"] },
      {
        rule: "sso/orphaned-verification-key",
        file: GOOGLE,
        says: ["nickname", "can never verify"],
      },
    ],
  },
  {
    name: "a mistyped mapping target that is one letter off a property",
    edit: (p) => {
      schemaOf(p).properties.contactEmail = {};
      connectionOf(p).claim_mapping = { email: "email", contactEmial: "mail" };
    },
    expect: [
      {
        rule: "sso/orphaned-mapping-target",
        file: GOOGLE,
        says: ["contactEmial", 'Did you mean "contactEmail"?', "Fix the name"],
      },
    ],
  },
  {
    name: "a mapping target that differs from a property only in case",
    edit: (p) => {
      schemaOf(p).properties.givenName = {};
      connectionOf(p).claim_mapping = { email: "email", givenname: "given_name" };
    },
    expect: [
      {
        rule: "sso/orphaned-mapping-target",
        file: GOOGLE,
        says: ["givenname", 'Did you mean "givenName"?'],
      },
    ],
  },
  {
    name: "a mistyped verification key",
    edit: (p) => {
      schemaOf(p).properties.contactEmail = { "x-unique": "project" };
      connectionOf(p).claim_mapping = { email: "email", contactEmial: "mail" };
      connectionOf(p).verified_claims = { contactEmial: "mail_verified" };
    },
    expect: [
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["contactEmial"] },
      {
        rule: "sso/orphaned-verification-key",
        file: GOOGLE,
        says: ["contactEmial", 'Did you mean "contactEmail"?', "can never verify"],
      },
    ],
  },
  {
    name: "a custom connection maps a standard claim without the scope that returns it",
    edit: (p) => {
      schemaOf(p).properties.givenName = { type: "string" };
      connectionOf(p).oidc = { client_id: "a", client_secret: "b", scopes: ["openid", "email"] };
      connectionOf(p).claim_mapping = { email: "email", givenName: "given_name" };
    },
    expect: [
      {
        rule: "sso/claim-needs-scope",
        file: GOOGLE,
        severity: "warning",
        says: ["claim_mapping", "given_name", '"profile"', 'Add "profile" to oidc.scopes'],
      },
    ],
  },
  {
    name: "a catalog connection maps a standard claim without the scope that returns it, which only warns as for a custom one",
    edit: (p) => {
      schemaOf(p).properties.givenName = { type: "string" };
      connectionOf(p).template = "google";
      connectionOf(p).oidc = { client_id: "a", client_secret: "b", scopes: ["openid", "email"] };
      connectionOf(p).claim_mapping = { email: "email", givenName: "given_name" };
    },
    expect: [
      {
        rule: "sso/claim-needs-scope",
        file: GOOGLE,
        severity: "warning",
        says: ["claim_mapping", "given_name", '"profile"', 'Add "profile" to oidc.scopes'],
      },
    ],
  },
  {
    name: "a custom connection verifies a standard claim without the scope that returns it",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).oidc = { client_id: "a", client_secret: "b", scopes: ["openid", "profile"] };
      connectionOf(p).claim_mapping = { email: "email" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
    expect: [
      {
        rule: "sso/claim-needs-scope",
        file: GOOGLE,
        severity: "warning",
        says: ["claim_mapping", '"email"'],
      },
      {
        rule: "sso/claim-needs-scope",
        file: GOOGLE,
        severity: "warning",
        says: ["verified_claims", "email_verified", '"email"'],
      },
    ],
  },
  {
    name: "a number claim is mapped into a string property",
    edit: (p) => {
      schemaOf(p).properties.refreshedAt = { type: "string" };
      connectionOf(p).claim_mapping = { email: "email", refreshedAt: "updated_at" };
    },
    expect: [
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        file: GOOGLE,
        says: ["updated_at", "number claim", "refreshedAt", "string", "change the type"],
      },
    ],
  },
  {
    name: "a boolean claim is mapped into a string property",
    edit: (p) => {
      schemaOf(p).properties.verified = { type: "string" };
      connectionOf(p).claim_mapping = { email: "email", verified: "email_verified" };
    },
    expect: [
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        file: GOOGLE,
        says: ["boolean claim", "verified"],
      },
    ],
  },
  {
    name: "an object claim is mapped into a string property",
    edit: (p) => {
      schemaOf(p).properties.home = { type: "string" };
      connectionOf(p).claim_mapping = { email: "email", home: "address" };
    },
    expect: [
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        file: GOOGLE,
        says: ["object claim", "home"],
      },
    ],
  },
  {
    name: "a string claim is mapped into an integer property",
    edit: (p) => {
      schemaOf(p).properties.age = { type: "integer" };
      connectionOf(p).claim_mapping = { email: "email", age: "birthdate" };
    },
    expect: [
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        file: GOOGLE,
        says: ["birthdate", "string claim", "integer"],
      },
    ],
  },
  {
    name: "a verification reads a claim that is not a boolean",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).verified_claims = { email: "email" };
    },
    expect: [
      {
        rule: "sso/verification-source-not-boolean",
        severity: "warning",
        file: GOOGLE,
        says: ["email", "string claim", "email_verified"],
      },
    ],
  },
  {
    name: "a claim name with a space around it",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email " };
    },
    expect: [
      {
        rule: "sso/claim-name-whitespace",
        file: GOOGLE,
        says: ["claim_mapping", '"email "', "Remove the space"],
      },
    ],
  },
  {
    name: "a verification source with a space around it",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).verified_claims = { email: " email_verified" };
    },
    expect: [
      {
        rule: "sso/claim-name-whitespace",
        file: GOOGLE,
        says: ["verified_claims", '" email_verified"'],
      },
    ],
  },
  {
    name: "a subject claim with a space around it",
    edit: (p) => {
      (connectionOf(p) as { subject_claim?: string }).subject_claim = "oid ";
    },
    expect: [
      { rule: "sso/claim-name-whitespace", file: GOOGLE, says: ["subject_claim", '"oid "'] },
    ],
  },
  {
    name: "the subject is a profile claim the user can change",
    edit: (p) => {
      (connectionOf(p) as { subject_claim?: string }).subject_claim = "email";
    },
    expect: [
      {
        rule: "sso/subject-claim-unstable",
        severity: "warning",
        file: GOOGLE,
        says: ['subject_claim is "email"', "can change", '"sub"'],
      },
    ],
  },
  {
    name: "the user-creating step leaves out a required property no provider maps",
    edit: (p) => {
      schemaOf(p).properties.companyName = { type: "string" };
      schemaOf(p).required = ["email", "companyName"];
    },
    expect: [
      {
        rule: "sso/collection-misses-required",
        file: LOGIN,
        steps: ["register-sso"],
        says: ['"companyName"', "create_user_with_sso", "Add it to fields"],
      },
    ],
  },
  {
    name: "the user-creating step leaves out a property only one of two providers maps",
    edit: (p) => {
      schemaOf(p).properties.companyName = { type: "string" };
      schemaOf(p).required = ["email", "companyName"];
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "other"];
      p.connections[".zitadel/idps/other.json"] = { slug: "other", claim_mapping: { email: "e" } };
      connectionOf(p).claim_mapping = { email: "email", companyName: "org" };
      stepOf(p, "identifier").sso_providers = ["google", "other"];
    },
    expect: [
      {
        rule: "sso/collection-misses-required",
        file: LOGIN,
        steps: ["register-sso"],
        says: ['"companyName"', "every provider", "map"],
      },
    ],
  },
  {
    name: "the user-creating step leaves out the property people sign in by",
    edit: (p) => {
      schemaOf(p).properties.username = { type: "string" };
      schemaOf(p)["x-identifier"] = "username";
      schemaOf(p)["x-auth-methods"].password = { enabled: true };
    },
    expect: [
      {
        rule: "sso/collection-misses-required",
        file: LOGIN,
        steps: ["register-sso"],
        says: ['"username"', "signs people in by"],
      },
    ],
  },
  {
    name: "a schema lists a provider twice",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "google"];
    },
    expect: [{ rule: "sso/duplicate-provider", file: STAFF, says: ['"google"', "more than once"] }],
  },
  {
    name: "a step offers a provider twice",
    edit: (p) => {
      stepOf(p, "identifier").sso_providers = ["google", "google"];
    },
    expect: [
      {
        rule: "sso/duplicate-provider",
        file: LOGIN,
        steps: ["identifier"],
        says: ['"google"', "twice"],
      },
    ],
  },
  {
    name: "a step list where two user-creating steps each miss a different required property",
    edit: (p) => {
      schemaOf(p).properties.a = { type: "string" };
      schemaOf(p).properties.b = { type: "string" };
      schemaOf(p).required = ["a", "b", "email"];
      stepOf(p, "register-sso").fields = ["email", "b"];
      p.flows[LOGIN]?.body.steps.push(
        aStep("register-other", { on_success: "create_user_with_sso", fields: ["email", "a"] }),
      );
    },
    expect: [
      {
        rule: "sso/collection-misses-required",
        file: LOGIN,
        steps: ["register-sso"],
        says: ['"a"'],
      },
      {
        rule: "sso/collection-misses-required",
        file: LOGIN,
        steps: ["register-other"],
        says: ['"b"'],
      },
    ],
  },
  {
    name: "a claim read by two rows and missing its scope",
    edit: (p) => {
      connectionOf(p).oidc = { client_id: "a", client_secret: "b", scopes: ["openid"] };
      connectionOf(p).claim_mapping = { email: "email", mail: "email" };
      schemaOf(p).properties.mail = { type: "string" };
      schemaOf(p)["x-identifier"] = "email";
    },
    expect: [
      {
        rule: "sso/claim-needs-scope",
        file: GOOGLE,
        severity: "warning",
        says: ['claim_mapping reads "email"'],
      },
    ],
  },
  {
    name: "an object claim is mapped into a string property, said with the right article",
    edit: (p) => {
      schemaOf(p).properties.home = { type: "string" };
      connectionOf(p).claim_mapping = { email: "email", home: "address" };
    },
    expect: [
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        file: GOOGLE,
        says: ["an object claim"],
      },
    ],
  },
  {
    name: "a connection no schema lists and no flow offers, with a subject the user can change",
    edit: (p) => {
      p.connections[".zitadel/idps/spare.json"] = {
        slug: "spare",
        subject_claim: "email",
        claim_mapping: { email: "email" },
      } as Connection;
    },
    expect: [
      {
        rule: "sso/subject-claim-unstable",
        severity: "warning",
        file: ".zitadel/idps/spare.json",
        says: ["email"],
      },
    ],
  },
  {
    name: "a misspelt section of a connection",
    edit: (p) => {
      (connectionOf(p) as Record<string, unknown>).claim_maping = { contactEmail: "mail" };
    },
    expect: [
      {
        rule: "sso/unknown-connection-field",
        file: GOOGLE,
        says: ['"claim_maping"', 'Did you mean "claim_mapping"?', "a connection"],
      },
    ],
  },
  {
    name: "a misspelt field of the oidc block",
    edit: (p) => {
      connectionOf(p).oidc = { client_id: "a", client_secret: "b" };
      (connectionOf(p).oidc as Record<string, unknown>).scope = ["openid"];
    },
    expect: [
      {
        rule: "sso/unknown-connection-field",
        file: GOOGLE,
        says: ['"scope"', 'Did you mean "scopes"?', "the oidc block"],
      },
    ],
  },
];

/** The edits that sit on a rule's boundary and must be accepted. */
const accepted: Array<{ name: string; edit: (project: Project) => void }> = [
  { name: "the project as scaffolded", edit: () => {} },
  {
    name: "a changeable subject_claim on a connection already deployed, which can no longer change it",
    edit: (p) => {
      (connectionOf(p) as { subject_claim?: string }).subject_claim = "email";
      p.deployed = ["google"];
    },
  },
  {
    name: "a verified property that is not unique, since a shared value can still be verified",
    edit: (p) => {
      schemaOf(p).properties.givenName = {};
      connectionOf(p).claim_mapping = { email: "email", givenName: "given_name" };
      connectionOf(p).verified_claims = { givenName: "given_name_verified" };
    },
  },
  {
    name: "a verification claim the admin chose for a property filled from another claim",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).claim_mapping = { email: "preferred_username" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
  },
  {
    name: "a schema with sso off that no flow offers providers from",
    edit: (p) => {
      p.schemas[PARTNERS] = aSchema({ enabled: false, providers: [] });
    },
  },
  {
    name: "two providers on one step, both listed",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "github"];
      stepOf(p, "identifier").sso_providers = ["google", "github"];
      p.connections[".zitadel/idps/github.json"] = {
        slug: "github",
        claim_mapping: { email: "e" },
      };
    },
  },
  {
    name: "a connection found by its slug, not its file name",
    edit: (p) => {
      p.connections = { ".zitadel/idps/sso.json": connectionOf(p) };
    },
  },
  {
    name: "a step with no providers that routes none of the provider outcomes",
    edit: (p) => {
      p.flows[LOGIN]?.body.steps.push(aStep("password", {}, ["submit"]));
    },
  },
  {
    name: "a plain create_user step with no conflict route",
    edit: (p) => {
      p.flows[LOGIN]?.body.steps.push(
        aStep("register-password", { on_success: "create_user" }, ["submit"]),
      );
    },
  },
  {
    name: "a target only one of two referencing schemas defines",
    edit: (p) => {
      schemaOf(p).properties.staffNumber = { "x-unique": "project" };
      p.schemas[PARTNERS] = aSchema();
      connectionOf(p).claim_mapping = { email: "email", staffNumber: "employee_id" };
      connectionOf(p).verified_claims = { staffNumber: "employee_verified" };
    },
  },
  {
    name: "a verified property unique at the project scope",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
  },
  {
    name: "a verified property unique at the team scope",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "team" };
      connectionOf(p).verified_claims = { email: "trusted" };
    },
  },
  {
    name: "a verified property unique in only one of two referencing schemas",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      p.schemas[PARTNERS] = aSchema();
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
  },
  {
    name: "standard claims read under the scopes that return them",
    edit: (p) => {
      schemaOf(p).properties.givenName = { type: "string" };
      schemaOf(p).properties.email = { type: "string", "x-unique": "project" };
      connectionOf(p).oidc = {
        client_id: "a",
        client_secret: "b",
        scopes: ["openid", "profile", "email"],
      };
      connectionOf(p).claim_mapping = { email: "email", givenName: "given_name" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
  },
  {
    name: "a connection with no scopes written down",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email" };
    },
  },
  {
    name: "a number claim mapped into an integer property",
    edit: (p) => {
      schemaOf(p).properties.refreshedAt = { type: "integer" };
      connectionOf(p).claim_mapping = { email: "email", refreshedAt: "updated_at" };
    },
  },
  {
    name: "a number claim mapped into a number property",
    edit: (p) => {
      schemaOf(p).properties.score = { type: "number" };
      connectionOf(p).claim_mapping = { email: "email", score: "updated_at" };
    },
  },
  {
    name: "a claim mapped into a property with no declared type",
    edit: (p) => {
      schemaOf(p).properties.refreshedAt = {};
      connectionOf(p).claim_mapping = { email: "email", refreshedAt: "updated_at" };
    },
  },
  {
    name: "a claim mapped into a property typed as a list of types that includes its own",
    edit: (p) => {
      schemaOf(p).properties.refreshedAt = { type: ["string", "number"] };
      connectionOf(p).claim_mapping = { email: "email", refreshedAt: "updated_at" };
    },
  },
  {
    name: "a claim the standard does not define, whatever the property type",
    edit: (p) => {
      schemaOf(p).properties.staffNumber = { type: "integer" };
      connectionOf(p).claim_mapping = { email: "email", staffNumber: "employee_id" };
    },
  },
  {
    name: "a claim mapped into a property typed in only one of two schemas that disagree",
    edit: (p) => {
      schemaOf(p).properties.refreshedAt = { type: "string" };
      p.schemas[PARTNERS] = aSchema({}, { refreshedAt: { type: "integer" } });
      connectionOf(p).claim_mapping = { email: "email", refreshedAt: "updated_at" };
    },
  },
  {
    name: "a verification that trusts the provider outright",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      (connectionOf(p) as { verified_claims?: Record<string, unknown> }).verified_claims = {
        email: true,
      };
    },
  },
  {
    name: "a subject claim that never changes",
    edit: (p) => {
      (connectionOf(p) as { subject_claim?: string }).subject_claim = "oid";
    },
  },
  {
    name: "the subject read from sub",
    edit: (p) => {
      (connectionOf(p) as { subject_claim?: string }).subject_claim = "sub";
    },
  },
  {
    name: "a required property the user-creating step asks for",
    edit: (p) => {
      schemaOf(p).properties.companyName = { type: "string" };
      schemaOf(p).required = ["email", "companyName"];
      stepOf(p, "register-sso").fields = ["email", "companyName"];
    },
  },
  {
    name: "a required property every provider maps",
    edit: (p) => {
      schemaOf(p).properties.companyName = { type: "string" };
      schemaOf(p).required = ["email", "companyName"];
      connectionOf(p).claim_mapping = { email: "email", companyName: "org" };
    },
  },
  {
    name: "a required object the user-creating step asks for by a nested field",
    edit: (p) => {
      schemaOf(p).properties.address = { type: "object" };
      schemaOf(p).required = ["email", "address"];
      stepOf(p, "register-sso").fields = ["email", "address.street"];
    },
  },
  {
    name: "a required property when the only provider cannot create users",
    edit: (p) => {
      schemaOf(p).properties.companyName = { type: "string" };
      schemaOf(p).required = ["email", "companyName"];
      connectionOf(p).provisioning = { creation: "disabled" };
      stepOf(p, "identifier").transitions = { sso_authenticated: { target: "done" } };
    },
  },
  {
    name: "the identifier is asked for by the user-creating step",
    edit: (p) => {
      schemaOf(p)["x-identifier"] = "email";
    },
  },
  {
    name: "the email verified by the claim that vouches for it",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).claim_mapping = { email: "email" };
      connectionOf(p).verified_claims = { email: "email_verified" };
    },
  },
  {
    name: "a property filled from one claim and verified by a claim the standard does not define",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).claim_mapping = { email: "mail" };
      connectionOf(p).verified_claims = { email: "mail_confirmed" };
    },
  },
  {
    name: "a username filled from the claim the identifier reads",
    edit: (p) => {
      schemaOf(p).properties.username = { type: "string" };
      schemaOf(p)["x-identifier"] = "username";
      stepOf(p, "register-sso").fields = ["email", "username"];
      connectionOf(p).claim_mapping = { email: "email", username: "email" };
    },
  },
  {
    name: "a verification of an object whose nested property is unique",
    edit: (p) => {
      schemaOf(p).properties.address = {
        type: "object",
        properties: { street: { type: "string", "x-unique": "project" } },
      };
      connectionOf(p).claim_mapping = { email: "email", address: "address" };
      (connectionOf(p) as { verified_claims?: Record<string, unknown> }).verified_claims = {
        address: true,
      };
    },
  },
  {
    name: "a verification source named like an Object.prototype member",
    edit: (p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).claim_mapping = { email: "constructor" };
      connectionOf(p).verified_claims = { email: "toString" };
    },
  },
  {
    name: "an identifier the user-creating step does not ask for, on a schema without a password",
    edit: (p) => {
      schemaOf(p).properties.username = { type: "string" };
      schemaOf(p)["x-identifier"] = "username";
    },
  },
  {
    name: "a nested identifier the user-creating step asks for by its path",
    edit: (p) => {
      schemaOf(p).properties.profile = {
        type: "object",
        properties: { mail: { type: "string", "x-unique": "project" } },
      };
      schemaOf(p)["x-identifier"] = "profile.mail";
      schemaOf(p)["x-auth-methods"].password = { enabled: true };
      stepOf(p, "register-sso").fields = ["email", "profile.mail"];
    },
  },
  {
    name: "a custom scope that may bundle the claims read",
    edit: (p) => {
      connectionOf(p).oidc = {
        client_id: "a",
        client_secret: "b",
        scopes: ["openid", "directory"],
      };
      connectionOf(p).claim_mapping = { email: "email" };
    },
  },
  {
    name: "a provider that only signs people in, with no mapping and only sso_authenticated routed",
    edit: (p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      connectionOf(p).claim_mapping = {};
      stepOf(p, "identifier").transitions = { sso_authenticated: { target: "done" } };
    },
  },
  {
    name: "a connection no schema lists and no flow offers",
    edit: (p) => {
      p.connections[".zitadel/idps/spare.json"] = {
        slug: "spare",
        claim_mapping: { typo: "x" },
        verified_claims: { typo: "y" },
      };
    },
  },
];

describe("validateProject: the SSO rules", () => {
  describe.each(broken)("when $name", ({ edit, expect: expected }) => {
    it("reports exactly what is wrong, where, and what to change", () => {
      const issues = validate(edit);

      expect(issues.map(({ rule, file, steps }) => ({ rule, file, steps }))).toEqual(
        expected.map(({ rule, file, steps }) => ({ rule, file, steps })),
      );
      for (const [index, { says }] of expected.entries()) {
        for (const fragment of says) {
          expect(issues[index]?.message).toContain(fragment);
        }
      }
    });

    it("is reported at its expected severity under a rule the registry knows at project scope", () => {
      const issues = validate(edit);

      expect(issues.map((issue) => issue.severity)).toEqual(
        expected.map(({ severity }) => severity ?? "error"),
      );
      for (const issue of issues) {
        expect(VALIDATION_RULES[issue.rule].scope).toBe("project");
      }
    });
  });

  it.each(accepted)("accepts $name", ({ edit }) => {
    expect(validate(edit)).toEqual([]);
  });

  it("never suggests trusting the provider outright when a verification reads a claim that is not a flag", () => {
    const [issue] = validate((p) => {
      schemaOf(p).properties.email = { "x-unique": "project" };
      connectionOf(p).verified_claims = { email: "email" };
    });

    expect(issue?.message).not.toMatch(/\btrue\b/);
  });

  it("has a failing case for every project rule in the registry", () => {
    const covered = new Set(broken.flatMap(({ expect: e }) => e.map(({ rule }) => rule)));
    const registered = Object.entries(VALIDATION_RULES)
      .filter(([, spec]) => spec.scope === "project")
      .map(([rule]) => rule);

    expect([...covered].sort()).toEqual(registered.sort());
  });
});

describe("how the rules read the project", () => {
  it("judges a mapping target against the schemas that list the connection, not all of them", () => {
    // `contactEmail` exists, but only in a schema that does not list google.
    const issues = validate((p) => {
      p.schemas[PARTNERS] = aSchema({ providers: [] }, { contactEmail: {} });
      connectionOf(p).claim_mapping = { email: "email", contactEmail: "mail" };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/orphaned-mapping-target"]);
  });

  it("suggests nothing for a name that is far from every property", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.contactEmail = {};
      connectionOf(p).claim_mapping = { email: "email", department: "dept" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).not.toContain("Did you mean");
  });

  it("suggests nothing when two properties are equally close", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.mobile1 = {};
      schemaOf(p).properties.mobile2 = {};
      connectionOf(p).claim_mapping = { email: "email", mobile3: "phone" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).not.toContain("Did you mean");
  });

  it("does not suggest a property that is already mapped", () => {
    const issues = validate((p) => {
      connectionOf(p).claim_mapping = { email: "email", emial: "mail" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).not.toContain("Did you mean");
  });

  it("allows only one edit in a short name", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.city = {};
      connectionOf(p).claim_mapping = { email: "email", cit: "city_name", ctyy: "c" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).toContain('Did you mean "city"?');
  });

  it("does not ask for uniqueness of a verified key it already reports as unmapped", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.givenName = {};
      connectionOf(p).verified_claims = { givenName: "given_name_verified" };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/unmapped-verification-key"]);
  });

  it("suggests nothing for a short name two edits away", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.city = {};
      connectionOf(p).claim_mapping = { email: "email", ctyy: "c" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).not.toContain("Did you mean");
  });

  it("suggests nothing for a one-character name", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.x = {};
      connectionOf(p).claim_mapping = { email: "email", y: "c" };
    });

    expect(issues.map((issue) => issue.message).join("\n")).not.toContain("Did you mean");
  });

  it("reports a provider listed twice and missing its file once", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "ghost", "ghost"];
    });

    expect(issues.filter((issue) => issue.rule === "sso/connection-resolves")).toHaveLength(1);
  });

  it("reports one missing scope once, however many claims need it", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.givenName = { type: "string" };
      schemaOf(p).properties.familyName = { type: "string" };
      connectionOf(p).oidc = { client_id: "a", client_secret: "b", scopes: ["openid"] };
      connectionOf(p).claim_mapping = {
        email: "email",
        givenName: "given_name",
        familyName: "family_name",
      };
    });

    const profile = issues.filter(
      (issue) => issue.rule === "sso/claim-needs-scope" && issue.message.includes('"profile"'),
    );
    expect(profile).toHaveLength(1);
    expect(profile[0]?.message).toContain('"given_name", "family_name"');
  });

  it("treats a space the way the server does, a byte-order mark as no space", () => {
    const issues = validate((p) => {
      connectionOf(p).claim_mapping = { email: "email\u0085" };
    });

    expect(issues.map((issue) => issue.rule)).toContain("sso/claim-name-whitespace");
    expect(
      validate((p) => {
        connectionOf(p).claim_mapping = { email: "email\uFEFF" };
      }).map((issue) => issue.rule),
    ).not.toContain("sso/claim-name-whitespace");
  });

  it("reports one cause once, however many steps it is made on", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["other"];
      p.connections[".zitadel/idps/other.json"] = { slug: "other", claim_mapping: { email: "e" } };
      p.flows[LOGIN]?.body.steps.push(
        aStep("register", { sso_providers: ["google"] }),
        aStep("sso-conflict", { sso_providers: ["google"] }),
      );
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.steps).toEqual(["identifier", "register", "sso-conflict"]);
    expect(issues[0]?.message).toContain('steps "identifier", "register", "sso-conflict"');
  });

  it("still checks a flow's routing when its schema could not be found", () => {
    const issues = validate((p) => {
      delete p.flows[LOGIN]?.schemaPath;
      stepOf(p, "identifier").transitions = {};
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
    expect(issues[0]?.message).toContain(
      "sso_authenticated, sso_user_not_found, user_already_exists",
    );
  });

  it("needs the register routes again when another provider on the step creates users", () => {
    const issues = validate((p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      p.connections[".zitadel/idps/other.json"] = { slug: "other", claim_mapping: { email: "e" } };
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "other"];
      const identifier = stepOf(p, "identifier");
      identifier.sso_providers = ["google", "other"];
      identifier.transitions = { sso_authenticated: { target: "done" } };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
  });

  it("still needs sso_authenticated from a provider that only signs people in", () => {
    const issues = validate((p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      stepOf(p, "identifier").transitions = {};
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
  });

  it("judges a connection a flow offers even when no schema lists it", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = [];
      connectionOf(p).verified_claims = { other: "x" };
    });

    expect(issues.map((issue) => issue.rule)).toContain("sso/unmapped-verification-key");
  });

  it("reads a connection by its slug, and the first file in path order stands for a duplicate", () => {
    const issues = validate((p) => {
      p.connections = {
        "b.json": { slug: "google", claim_mapping: { email: "email" } },
        "a.json": { slug: "google", claim_mapping: { typo: "x" } },
      };
    });

    // a.json is judged as the file; b.json is only named as the duplicate.
    expect(issues.map(({ rule, file }) => ({ rule, file }))).toEqual([
      { rule: "sso/duplicate-slug", file: "b.json" },
      { rule: "sso/orphaned-mapping-target", file: "a.json" },
    ]);
  });

  it("does not also report the missing listing when sso is off, which one error already says", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso = { enabled: false, providers: [] };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/flow-enables-sso"]);
  });

  it("collects every issue instead of stopping at the first", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["a", "b"];
      p.connections = {};
    });

    // Two providers the schema lists with no file, then the one the flow offers
    // with no file: its missing file is the cause, so that it is also unlisted
    // is not said again.
    expect(issues.map((issue) => issue.rule)).toEqual([
      "sso/connection-resolves",
      "sso/connection-resolves",
      "sso/connection-resolves",
    ]);
  });

  it.each([["email_verified"], [true]])(
    "asks for a claim_mapping row for a verified_claims value of %s, because the engine reads the row first",
    (value) => {
      const issues = validate((p) => {
        connectionOf(p).verified_claims = { email: value as string };
        connectionOf(p).claim_mapping = {};
      });

      expect(issues.map((issue) => issue.rule)).toContain("sso/unmapped-verification-key");
    },
  );

  it("takes a dotted claim_mapping name for no property, as the engine does", () => {
    const issues = validate((p) => {
      schemaOf(p).properties.address = { properties: { street: {} } };
      connectionOf(p).claim_mapping = { "address.street": "street" };
    });

    expect(issues.map((issue) => issue.rule)).toContain("sso/orphaned-mapping-target");
  });

  it("says which connection slug a provider with no file is", () => {
    const issues = validate((p) => {
      p.connections = {};
    });

    expect(
      issues.filter((issue) => issue.rule === "sso/connection-resolves").map((i) => i.slug),
    ).toEqual(["google"]);
  });

  it("names a verified_claims key that no schema has once, not twice", () => {
    const issues = validate((p) => {
      connectionOf(p).verified_claims = { typo: "email_verified" };
    });

    expect(
      issues.map((issue) => issue.rule).filter((rule) => rule.includes("verification")),
    ).toEqual(["sso/orphaned-verification-key"]);
  });

  it("does not take prototype keys for mapped properties", () => {
    const issues = validate((p) => {
      connectionOf(p).claim_mapping = { email: "email", constructor: "x" };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/orphaned-mapping-target"]);
  });
});

describe("a connection the CLI scaffolds", () => {
  const providers = [
    ["Google", () => new GoogleProvider()],
    [
      "a custom connection",
      () =>
        new CustomOidcProvider({
          slug: slug("acme-sso"),
          displayName: displayName("Acme SSO"),
          issuer: issuer("https://sso.acme.example"),
          scopes: DEFAULT_SCOPES,
        }),
    ],
    [
      "a custom connection with only openid",
      () =>
        new CustomOidcProvider({
          slug: slug("acme-sso"),
          displayName: displayName("Acme SSO"),
          issuer: issuer("https://sso.acme.example"),
          scopes: ["openid"],
        }),
    ],
  ] as const;

  it.each(
    providers.flatMap(([name, make]) =>
      SETUP_PRESETS.flatMap((preset) =>
        SETUP_USE_CASES.map((useCase) => ({ name, make, preset, useCase })),
      ),
    ),
  )(
    "breaks no rule for $name on the $preset preset and $useCase use case",
    ({ make, preset, useCase }) => {
      const provider = make();
      const schema = getDefaultHumanUserSchema({ preset, useCase }) as unknown as {
        properties: Record<string, unknown>;
      };
      const connection = provider.connection({ schemaProperties: Object.keys(schema.properties) });
      const tree: ProjectTree = {
        schemas: new Map([
          [
            STAFF,
            {
              ...schema,
              "x-auth-methods": { sso: { enabled: true, providers: [connection.slug as string] } },
            },
          ],
        ]),
        flows: new Map(),
        connections: new Map([[GOOGLE, connection]]),
      };

      expect(validateProject(tree)).toEqual([]);
    },
  );
});
