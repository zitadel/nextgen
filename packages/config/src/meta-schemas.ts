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
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { distance } from "fastest-levenshtein";

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
let userSchemaCheck: ValidateFunction | undefined;

function compileUserSchema(): ValidateFunction {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  for (const file of metaSchemaFiles()) {
    if (file.body !== userSchemaMetaSchema) {
      ajv.addSchema(file.body, file.name);
    }
  }
  return ajv.compile(userSchemaMetaSchema);
}

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** Every JSON Schema 2020-12 keyword, read on first use and kept for the process. */
let draftKeywords: string[] | undefined;

/**
 * The keywords the draft 2020-12 meta-schema and the vocabularies it combines
 * declare, as the Ajv that ships them holds them.
 */
function readDraftKeywords(): string[] {
  const ajv = new Ajv2020({ strict: false });
  const metaSchemaAt = (uri: string) =>
    ajv.getSchema(uri)?.schema as { allOf?: { $ref: string }[]; properties?: object };
  const draft = metaSchemaAt(DRAFT_2020_12);
  return [
    draft,
    ...(draft.allOf ?? []).map(({ $ref }) => metaSchemaAt(new URL($ref, DRAFT_2020_12).href)),
  ].flatMap((schema) => Object.keys(schema.properties ?? {}));
}

/**
 * What the server refuses a `.zitadel/schemas/` file for, as to its shape and
 * its keys, so `deploy`, `doctor` and the API mock judge a file alike. The
 * shape comes from the generated Zod, which accepts a user schema or a
 * `schema-url` reference. A user schema then also runs through the user
 * meta-schema the server compiles, because the Zod drops what it says about
 * keys: a misspelt keyword such as `minimumLength` is refused, with the
 * keyword it is closest to, as is an `x-` key it does not declare. Every
 * refused key is reported.
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

  userSchemaCheck ??= compileUserSchema();
  const check = userSchemaCheck;
  if (check(document)) {
    return issues;
  }
  for (const error of check.errors ?? []) {
    // An unevaluated property is a key the meta-schema does not declare; a
    // property name is an attribute name `property-name.json` refuses.
    const keyword = error.params.unevaluatedProperty as string | undefined;
    const key = keyword ?? (error.params.propertyName as string | undefined);
    if (key === undefined) {
      continue;
    }
    const path = error.instancePath.slice(1).replaceAll("/", ".");
    let suggestion = "";
    if (keyword !== undefined) {
      const declared = path === "" ? userSchemaMetaSchema : userPropertyMetaSchema;
      // A third of the key's length lets `minimumLength` reach `minLength`
      // without matching a short key such as `kind` to `$id`.
      draftKeywords ??= readDraftKeywords();
      const [near] = [...draftKeywords, ...Object.keys(declared.properties)]
        .map((allowed) => ({ allowed, cost: distance(keyword, allowed) }))
        .filter(({ cost }) => cost <= keyword.length / 3)
        .sort((a, b) => a.cost - b.cost);
      suggestion = near ? `. Did you mean ${near.allowed}?` : "";
    }
    issues.push({ path, message: `${key} is not an allowed key${suggestion}`, key });
  }
  return issues;
}
