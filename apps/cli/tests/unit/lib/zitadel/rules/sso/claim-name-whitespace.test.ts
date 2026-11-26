import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_PATH, ACME, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/claim-name-whitespace", () => {
  it.each([
    {
      rule: "sso/claim-name-whitespace",
      severity: "error",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: " email" },
          oidc: { scopes: ["openid", "email"] },
        }),
      ),
      file: CONNECTION_PATH,
      message: 'claim_mapping names " email", which has a space at its start or end',
    },
    {
      rule: "sso/claim-name-whitespace",
      severity: "error",
      documents: agreeing(anOidcConnection({ subject_claim: "oid " })),
      file: CONNECTION_PATH,
      message: 'subject_claim names "oid "',
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

  it.each([{ rule: "sso/claim-name-whitespace", documents: agreeing(ACME) }] satisfies readonly {
    readonly rule: string;
    readonly documents: ConfigDocuments;
  }[])("$rule stays silent on a project that does not break it", (row) => {
    const issues = issuesOf(row.rule, row.documents);

    expect(issues).toEqual([]);
  });
});
