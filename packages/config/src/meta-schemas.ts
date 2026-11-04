/**
 * The dialect meta-schemas `zitadel setup` copies into a project's
 * `.zitadel/meta/` so the flow/schema dialect is machine-readable offline:
 * editors validate flow files against `flow-definition.json` via a relative
 * `$schema` pointer, and agents read the dialect files before authoring
 * edits — no docs crawl, no hosted schema required.
 *
 * The files under `meta-schemas/` are generated: `scripts/sync-meta-schemas.mjs`
 * copies them from `api/openapi/endpoints/schemas/*.json` (the files the
 * server embeds) ahead of build, typecheck and test. Those are generated in
 * turn from the OpenAPI YAML by `scripts/generate-meta-schemas.ts` at the repo
 * root, so the YAML is the only thing to edit.
 *
 * `project.json`, the schema of `zitadel.json`, is the exception: only the CLI
 * reads that file, so its schema is written by hand here
 * (`project-config.schema.json`) and never reaches the server.
 */
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import { schemaConfigSchema } from "./schemas.js";
import authMethodMetaSchema from "../meta-schemas/auth-method.json" with { type: "json" };
import authMethodsMetaSchema from "../meta-schemas/auth-methods.json" with { type: "json" };
import brandingMetaSchema from "../meta-schemas/branding.json" with { type: "json" };
import flowDefinitionMetaSchema from "../meta-schemas/flow-definition.json" with { type: "json" };
import idpConnectionMetaSchema from "../meta-schemas/idp-connection.json" with { type: "json" };
import policyMetaSchema from "../meta-schemas/policy.json" with { type: "json" };
import policyTestMetaSchema from "../meta-schemas/policy-test.json" with { type: "json" };
import propertyNameMetaSchema from "../meta-schemas/property-name.json" with { type: "json" };
import ssoAuthMethodMetaSchema from "../meta-schemas/sso-auth-method.json" with { type: "json" };
import userPropertyMetaSchema from "../meta-schemas/user-property.json" with { type: "json" };
import userSchemaMetaSchema from "../meta-schemas/user-schema.json" with { type: "json" };
import projectConfigSchema from "./project-config.schema.json" with { type: "json" };

/** Project-relative directory setup writes the meta-schemas to. */
export const META_SCHEMA_DIR = ".zitadel/meta";

/**
 * The `$schema` value scaffolded flow files carry, relative to
 * `.zitadel/flows/` — resolves to `{@link META_SCHEMA_DIR}/flow-definition.json`.
 */
export const FLOW_FILE_SCHEMA_REF = "../meta/flow-definition.json";

/**
 * The `$schema` value scaffolded branding files carry, relative to
 * `.zitadel/branding/` — resolves to `{@link META_SCHEMA_DIR}/branding.json`.
 */
export const BRANDING_FILE_SCHEMA_REF = "../meta/branding.json";

/**
 * The `$schema` value policy files carry, relative to `.zitadel/policies/` —
 * resolves to `{@link META_SCHEMA_DIR}/policy.json`.
 */
export const POLICY_FILE_SCHEMA_REF = "../meta/policy.json";

/**
 * The `$schema` value policy test files carry, relative to
 * `.zitadel/policies/` — resolves to `{@link META_SCHEMA_DIR}/policy-test.json`.
 */
export const POLICY_TEST_FILE_SCHEMA_REF = "../meta/policy-test.json";

/**
 * The `$schema` value `zitadel.json` carries, relative to the project root —
 * resolves to `{@link META_SCHEMA_DIR}/project.json`.
 */
export const PROJECT_FILE_SCHEMA_REF = "./.zitadel/meta/project.json";

export type MetaSchemaFile = { name: string; body: object };

/**
 * The dialect files to materialize, in write order. `auth-methods.json`,
 * `auth-method.json`, and `sso-auth-method.json` are pulled in by
 * `user-schema.json`'s relative `$ref`s — without them the copied dialect
 * cannot resolve offline.
 */
export function metaSchemaFiles(): ReadonlyArray<MetaSchemaFile> {
  return [
    { name: "flow-definition.json", body: flowDefinitionMetaSchema as object },
    { name: "user-schema.json", body: userSchemaMetaSchema as object },
    { name: "user-property.json", body: userPropertyMetaSchema as object },
    { name: "property-name.json", body: propertyNameMetaSchema as object },
    { name: "auth-methods.json", body: authMethodsMetaSchema as object },
    { name: "auth-method.json", body: authMethodMetaSchema as object },
    { name: "sso-auth-method.json", body: ssoAuthMethodMetaSchema as object },
    { name: "idp-connection.json", body: idpConnectionMetaSchema as object },
    { name: "branding.json", body: brandingMetaSchema as object },
    { name: "policy.json", body: policyMetaSchema as object },
    { name: "policy-test.json", body: policyTestMetaSchema as object },
    { name: "project.json", body: projectConfigSchema as object },
  ];
}

/** One rule a schema file breaks, at the object it is in. */
export type SchemaFileIssue = {
  /** The object, as dot-joined keys from the document root; "" for the root. */
  path: string;
  message: string;
  /** The key the meta-schema refuses, when the rule is about a key. */
  key?: string;
};

/** The user meta-schema, compiled on first use and kept for the process. */
const compiled: { userSchema?: ValidateFunction } = {};

/**
 * Every rule a `.zitadel/schemas/` file breaks that the server would refuse
 * it for, so `deploy`, `doctor` and the API mock judge a file alike. The
 * request shape comes from the generated Zod, which accepts a user schema or
 * a `schema-url` reference. A user schema then also runs through the user
 * meta-schema the server compiles, because the Zod drops what it says about
 * keys: a misspelt keyword such as `minimumLength` is refused, as is an `x-`
 * key it does not declare. Every refused key is reported. Any other rule is
 * reported only when the Zod passed, since it would repeat a Zod issue, and
 * only its first failure, since Ajv also reports every branch of an `anyOf`
 * it tried.
 */
export function schemaFileIssues(document: unknown): SchemaFileIssue[] {
  const parsed = schemaConfigSchema.safeParse(document);
  const issues: SchemaFileIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
  if ((document as { kind?: unknown } | null)?.kind !== "user-schema") {
    return issues;
  }

  compiled.userSchema ??= (() => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    for (const file of metaSchemaFiles()) {
      ajv.addSchema(file.body, file.name);
    }
    const check = ajv.getSchema("user-schema.json");
    if (check === undefined) {
      throw new Error("user-schema.json is not among the meta-schemas");
    }
    return check;
  })();
  const check = compiled.userSchema;
  if (check(document)) {
    return issues;
  }
  const errors = check.errors ?? [];
  const pathOf = (instancePath: string) =>
    instancePath
      .split("/")
      .slice(1)
      .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
      .join(".");
  for (const error of errors) {
    const key = (error.params.unevaluatedProperty ?? error.params.propertyName) as
      | string
      | undefined;
    if (key !== undefined) {
      issues.push({
        path: pathOf(error.instancePath),
        message: `${key} is not an allowed key`,
        key,
      });
    }
  }
  const [first] = errors;
  if (parsed.success && issues.length === 0 && first !== undefined) {
    const allowed = first.params.allowedValues as unknown[] | undefined;
    issues.push({
      path: pathOf(first.instancePath),
      message:
        allowed === undefined ? `${first.message}` : `${first.message}: ${allowed.join(", ")}`,
    });
  }
  return issues;
}
