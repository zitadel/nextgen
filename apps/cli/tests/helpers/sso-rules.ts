import type { ConfigOptions, Issue, JsonObject } from "@/lib/zitadel";
import { isJsonObject, listAt } from "@/lib/zitadel/utils/json";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";

/**
 * The file name of the schema in these tests.
 */
export const SCHEMA_FILE = "staff.json";

/**
 * Where the schema in these tests sits.
 */
export const SCHEMA_PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The file name of the flow in these tests.
 */
export const FLOW_FILE = "login.json";

/**
 * Where the flow in these tests sits.
 */
export const FLOW_PATH = `.zitadel/flows/${FLOW_FILE}`;

/**
 * The file name of the connection in these tests.
 */
export const CONNECTION_FILE = "acme.json";

/**
 * Where the connection in these tests sits.
 */
export const CONNECTION_PATH = `.zitadel/idps/${CONNECTION_FILE}`;

/**
 * The file name of a second connection claiming the same slug.
 */
export const COPY_FILE = "copy.json";

/**
 * The `$id` a schema and the flow pinning it may both name.
 */
export const SCHEMA_ID = "https://schemas.example.test/staff.json";

/**
 * The connection the schema and flow name, mapping the email claim it asks
 * for.
 */
export const ACME = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"] },
});

/**
 * A second connection claiming {@link ACME}'s slug, with a secret of its own.
 */
export const ACME_COPY = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"], client_secret: "${{ COPY_CLIENT_SECRET }}" },
});

/**
 * A second connection, `other`, that nobody lists or offers.
 */
export const OTHER_PATH = ".zitadel/idps/other.json";

/**
 * The schema listing `acme`, with a property whose type is a number.
 */
export const NUMERIC_EMAIL_SCHEMA = aSchemaListing(["acme"], {
  properties: { email: { "x-unique": "project", type: "integer" } },
});

/**
 * Every project below lists `acme` in its schema, offers it in its flow
 * and keeps the connection `acme.json`: the documents of a project whose
 * files agree, but for what a row changes.
 *
 * @param connection - The connection file `acme.json` holds.
 * @param overrides - Documents to set in place of the agreeing ones.
 * @returns The documents.
 */
export function agreeing(connection: JsonObject, overrides: ConfigDocuments = {}): ConfigDocuments {
  return {
    schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
    flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
    connections: { [CONNECTION_FILE]: connection },
    ...overrides,
  };
}

/**
 * A flow whose entry step offers `acme` and whose other steps are as given.
 *
 * @param step - Keys to set on the entry step in place of the routed ones.
 * @param extra - Further steps.
 * @returns The flow document.
 */
export function aFlowStepping(step: JsonObject, extra: readonly JsonObject[] = []): JsonObject {
  const offering = aFlowOffering(["acme"]);
  const entry = listAt(offering, "steps")[0];
  return { ...offering, steps: [{ ...(isJsonObject(entry) ? entry : {}), ...step }, ...extra] };
}

/**
 * Find the issues of one rule.
 *
 * @param rule - The rule's id.
 * @param documents - The project's documents.
 * @param options - What is known beyond the files.
 * @returns The rule's issues.
 */
export function issuesOf(
  rule: string,
  documents: ConfigDocuments,
  options: ConfigOptions = {},
): readonly Issue[] {
  return SSO_RULES.flatMap((candidate) => {
    return candidate.check(aConfig(documents, options), {});
  }).filter((issue) => {
    return issue.rule === rule;
  });
}
