import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_FILE, ACME, issuesOf } from "@tests/helpers/sso-rules";

/**
 * A second connection, `other`, that nobody lists or offers.
 */
const OTHER_PATH = ".zitadel/idps/other.json";

describe("sso/shared-variable", () => {
  it.each([
    {
      rule: "sso/shared-variable",
      severity: "error",
      documents: {
        connections: {
          [CONNECTION_FILE]: ACME,
          "other.json": anOidcConnection({ slug: "other" }),
        },
      },
      file: OTHER_PATH,
      message: "client_secret names the variable ACME_CLIENT_SECRET",
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
      rule: "sso/shared-variable",
      documents: {
        connections: {
          [CONNECTION_FILE]: ACME,
          "other.json": anOidcConnection({
            slug: "other",
            oidc: { client_secret: "${{ OTHER_SECRET }}" },
          }),
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
});
