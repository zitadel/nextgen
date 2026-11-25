import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_PATH, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/subject-claim-unstable", () => {
  it.each([
    {
      rule: "sso/subject-claim-unstable",
      severity: "warning",
      documents: agreeing(anOidcConnection({ subject_claim: "email" })),
      file: CONNECTION_PATH,
      message: 'subject_claim is "email", a profile claim the user can change',
    },
    {
      rule: "sso/subject-claim-unstable",
      severity: "warning",
      documents: agreeing(anOidcConnection({ subject_claim: "username" })),
      file: CONNECTION_PATH,
      message: 'subject_claim is "username"',
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
      rule: "sso/subject-claim-unstable",
      documents: agreeing(anOidcConnection({ subject_claim: "sub" })),
    },
    {
      rule: "sso/subject-claim-unstable",
      documents: agreeing(anOidcConnection({ subject_claim: "oid" })),
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );

  it("does not warn about an unstable subject once the connection is deployed", () => {
    const documents = agreeing(anOidcConnection({ subject_claim: "email" }));

    const issues = issuesOf("sso/subject-claim-unstable", documents, {
      deployed: new Set(["acme"]),
    });

    expect(issues).toEqual([]);
  });
});
