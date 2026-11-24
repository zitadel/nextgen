import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aSchemaListing } from "@tests/helpers/schemas";
import {
  ACME,
  CONNECTION_PATH,
  FLOW_PATH,
  SCHEMA_FILE,
  SCHEMA_PATH,
  aRequiringSchema,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/impossible-auto-creation-verification", () => {
  it.each([
    {
      rule: "sso/impossible-auto-creation-verification",
      severity: "warning",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email", phone: "phone" },
          verified_claims: { phone: true },
        }),
        { schemas: { [SCHEMA_FILE]: aRequiringSchema() } },
      ),
      file: FLOW_PATH,
      message: `step "identifier": "acme" creates users automatically, but ${SCHEMA_PATH} requires unique "email" and verified_claims of ${CONNECTION_PATH} has no entry for "email"`,
    },
  ] satisfies readonly {
    readonly rule: string;
    readonly severity: string;
    readonly documents: ConfigDocuments;
    readonly file: string;
    readonly message: string;
  }[])("$rule fires: $message", (row) => {
    const issues = issuesOf(row.rule, row.documents);

    expect(issues).toMatchObject([
      {
        severity: row.severity,
        rule: row.rule,
        file: row.file,
        message: expect.stringContaining(row.message),
      },
    ]);
  });

  it.each([
    { rule: "sso/impossible-auto-creation-verification", documents: agreeing(ACME) },
    {
      rule: "sso/impossible-auto-creation-verification",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email", phone: "phone" },
          verified_claims: { email: true, phone: true },
        }),
        { schemas: { [SCHEMA_FILE]: aRequiringSchema() } },
      ),
    },
    {
      rule: "sso/impossible-auto-creation-verification",
      documents: agreeing(anOidcConnection({ claim_mapping: {} }), {
        schemas: { [SCHEMA_FILE]: aRequiringSchema() },
      }),
    },
    {
      rule: "sso/impossible-auto-creation-verification",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email", phone: "phone" },
          provisioning: { creation: "disabled" },
        }),
        { schemas: { [SCHEMA_FILE]: aRequiringSchema() } },
      ),
    },
    {
      rule: "sso/impossible-auto-creation-verification",
      documents: agreeing(anOidcConnection({ claim_mapping: { email: "email" } }), {
        schemas: {
          [SCHEMA_FILE]: aSchemaListing(["acme"], {
            required: ["email"],
            properties: { email: { type: "string" } },
          }),
        },
      }),
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );
});
