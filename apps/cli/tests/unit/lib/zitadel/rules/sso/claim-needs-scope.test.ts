import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_PATH, ACME, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/claim-needs-scope", () => {
  it.each([
    {
      rule: "sso/claim-needs-scope",
      severity: "warning",
      documents: agreeing(anOidcConnection({ claim_mapping: { email: "email" } })),
      file: CONNECTION_PATH,
      message: 'claim_mapping reads "email", which a provider only returns for the "email" scope',
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
    { rule: "sso/claim-needs-scope", documents: agreeing(ACME) },
    {
      rule: "sso/claim-needs-scope",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email" },
          oidc: { scopes: ["openid", "custom"] },
        }),
      ),
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );
});
