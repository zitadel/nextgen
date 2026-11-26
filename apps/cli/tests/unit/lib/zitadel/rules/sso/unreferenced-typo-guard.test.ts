import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aSchemaListing } from "@tests/helpers/schemas";
import {
  CONNECTION_FILE,
  CONNECTION_PATH,
  SCHEMA_FILE,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/unreferenced-typo-guard", () => {
  it.each([
    {
      rule: "sso/unreferenced-typo-guard",
      severity: "warning",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: {
          [CONNECTION_FILE]: anOidcConnection({ claim_mapping: { emial: "email" } }),
        },
      },
      file: CONNECTION_PATH,
      message:
        'claim_mapping target "emial" is not a property of any schema in the project, so it looks mistyped. Did you mean "email"?',
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
    {
      rule: "sso/unreferenced-typo-guard",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: {
          [CONNECTION_FILE]: anOidcConnection({
            claim_mapping: { email: "email" },
            verified_claims: { email: true },
          }),
        },
      },
    },
    {
      rule: "sso/unreferenced-typo-guard",
      documents: agreeing(anOidcConnection({ claim_mapping: { emial: "email" } }), {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      }),
    },
    {
      rule: "sso/unreferenced-typo-guard",
      documents: agreeing(anOidcConnection({ claim_mapping: { emial: "email" } })),
    },
    {
      rule: "sso/unreferenced-typo-guard",
      documents: {
        connections: {
          [CONNECTION_FILE]: anOidcConnection({ claim_mapping: { emial: "email" } }),
        },
      },
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );

  it("warns of a verified_claims key no schema defines on a connection no schema lists", () => {
    const documents = {
      schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      connections: {
        [CONNECTION_FILE]: anOidcConnection({ verified_claims: { emial: true } }),
      },
    };

    const issues = issuesOf("sso/unreferenced-typo-guard", documents);

    expect(issues).toMatchObject([
      {
        severity: "warning",
        file: CONNECTION_PATH,
        message: expect.stringContaining('verified_claims key "emial" is not a property'),
      },
    ]);
  });
});
