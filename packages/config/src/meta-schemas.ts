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
import appApiMetaSchema from "../meta-schemas/app-api.json" with { type: "json" };
import appClientMetaSchema from "../meta-schemas/app-client.json" with { type: "json" };
import appRegistrationMetaSchema from "../meta-schemas/app-registration.json" with { type: "json" };
import appMetaSchema from "../meta-schemas/app.json" with { type: "json" };
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
 * The `$schema` value app files carry, relative to `.zitadel/apps/` —
 * resolves to `{@link META_SCHEMA_DIR}/app.json`.
 */
export const APP_FILE_SCHEMA_REF = "../meta/app.json";

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
    // `app.json` pulls in one schema per config kind through relative `$ref`s.
    { name: "app.json", body: appMetaSchema as object },
    { name: "app-client.json", body: appClientMetaSchema as object },
    { name: "app-api.json", body: appApiMetaSchema as object },
    { name: "app-registration.json", body: appRegistrationMetaSchema as object },
    { name: "branding.json", body: brandingMetaSchema as object },
    { name: "policy.json", body: policyMetaSchema as object },
    { name: "policy-test.json", body: policyTestMetaSchema as object },
    { name: "project.json", body: projectConfigSchema as object },
  ];
}
