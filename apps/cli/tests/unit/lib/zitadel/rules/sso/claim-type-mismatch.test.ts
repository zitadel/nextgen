import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aSchemaListing } from "@tests/helpers/schemas";
import {
  SCHEMA_FILE,
  CONNECTION_PATH,
  ACME,
  NUMERIC_EMAIL_SCHEMA,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/claim-type-mismatch", () => {
  it.each([
    {
      rule: "sso/claim-type-mismatch",
      severity: "warning",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email" },
          oidc: { scopes: ["openid", "email"] },
        }),
        { schemas: { [SCHEMA_FILE]: NUMERIC_EMAIL_SCHEMA } },
      ),
      file: CONNECTION_PATH,
      message: 'reads "email", a string claim, into "email", which the schema types as integer',
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
    { rule: "sso/claim-type-mismatch", documents: agreeing(ACME) },
    {
      rule: "sso/claim-type-mismatch",
      documents: agreeing(ACME, {
        schemas: {
          [SCHEMA_FILE]: aSchemaListing(["acme"], {
            properties: { email: { "x-unique": "project", type: "string" } },
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
