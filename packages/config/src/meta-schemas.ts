/**
 * The dialect meta-schemas `zitadel setup` copies into a project's
 * `.zitadel/meta/` so the flow/schema dialect is machine-readable offline:
 * editors validate flow files against `flow-definition.json` via a relative
 * `$schema` pointer, and agents read the dialect files before authoring
 * edits — no docs crawl, no hosted schema required.
 *
 * The files under `meta-schemas/` are committed copies of
 * `api/openapi/endpoints/schemas/*.json` (the source the server embeds);
 * a drift-audit test keeps them byte-identical in the monorepo.
 */
import authMethodMetaSchema from "../meta-schemas/auth-method.json" with {
  type: "json",
};
import authMethodsMetaSchema from "../meta-schemas/auth-methods.json" with {
  type: "json",
};
import brandingMetaSchema from "../meta-schemas/branding.json" with {
  type: "json",
};
import flowDefinitionMetaSchema from "../meta-schemas/flow-definition.json" with {
  type: "json",
};
import propertyNameMetaSchema from "../meta-schemas/property-name.json" with {
  type: "json",
};
import userPropertyMetaSchema from "../meta-schemas/user-property.json" with {
  type: "json",
};
import userSchemaMetaSchema from "../meta-schemas/user-schema.json" with {
  type: "json",
};

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

export type MetaSchemaFile = { name: string; body: object };

/**
 * The dialect files to materialize, in write order. `auth-methods.json` and
 * `auth-method.json` are pulled in by `user-schema.json`'s relative `$ref`s —
 * without them the copied dialect cannot resolve offline.
 */
export function metaSchemaFiles(): ReadonlyArray<MetaSchemaFile> {
  return [
    { name: "flow-definition.json", body: flowDefinitionMetaSchema as object },
    { name: "user-schema.json", body: userSchemaMetaSchema as object },
    { name: "user-property.json", body: userPropertyMetaSchema as object },
    { name: "property-name.json", body: propertyNameMetaSchema as object },
    { name: "auth-methods.json", body: authMethodsMetaSchema as object },
    { name: "auth-method.json", body: authMethodMetaSchema as object },
    { name: "branding.json", body: brandingMetaSchema as object },
  ];
}
