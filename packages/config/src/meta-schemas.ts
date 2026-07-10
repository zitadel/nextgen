/**
 * The dialect meta-schemas `zitadel setup` copies into a project's
 * `.zitadel/meta/` so the flow/schema dialect is machine-readable offline:
 * editors validate flow files against `flow-definition.json` via a relative
 * `$schema` pointer, and agents read all three before authoring edits —
 * no docs crawl, no hosted schema required.
 *
 * The files under `meta-schemas/` are committed copies of
 * `api/openapi/endpoints/schemas/*.json` (the source the server embeds);
 * a drift-audit test keeps them byte-identical in the monorepo.
 */
import flowDefinitionMetaSchema from "../meta-schemas/flow-definition.json" with {
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

export type MetaSchemaFile = { name: string; body: object };

/** The dialect files to materialize, in write order. */
export function metaSchemaFiles(): ReadonlyArray<MetaSchemaFile> {
  return [
    { name: "flow-definition.json", body: flowDefinitionMetaSchema as object },
    { name: "user-schema.json", body: userSchemaMetaSchema as object },
    { name: "user-property.json", body: userPropertyMetaSchema as object },
  ];
}
