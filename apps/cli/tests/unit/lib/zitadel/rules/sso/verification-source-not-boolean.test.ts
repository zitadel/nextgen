import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_PATH, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/verification-source-not-boolean", () => {
  it.each([
    {
      rule: "sso/verification-source-not-boolean",
      severity: "warning",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email" },
          verified_claims: { email: "email" },
          oidc: { scopes: ["openid", "email"] },
        }),
      ),
      file: CONNECTION_PATH,
      message: 'verified_claims reads "email" to verify "email", but that is a string claim',
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
      rule: "sso/verification-source-not-boolean",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email" },
          verified_claims: { email: "email_verified" },
          oidc: { scopes: ["openid", "email"] },
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
