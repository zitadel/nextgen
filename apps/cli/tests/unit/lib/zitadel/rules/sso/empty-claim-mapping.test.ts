import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { FLOW_PATH, CONNECTION_PATH, ACME, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/empty-claim-mapping", () => {
  it.each([
    {
      rule: "sso/empty-claim-mapping",
      severity: "error",
      documents: agreeing(anOidcConnection({ claim_mapping: {} })),
      file: FLOW_PATH,
      message: `claim_mapping of "acme" (${CONNECTION_PATH}) is empty, so no sign-in can fill the user`,
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
    { rule: "sso/empty-claim-mapping", documents: agreeing(ACME) },
    {
      rule: "sso/empty-claim-mapping",
      documents: agreeing(anOidcConnection({ claim_mapping: { nickname: "name" } })),
    },
    {
      rule: "sso/empty-claim-mapping",
      documents: agreeing(
        anOidcConnection({ claim_mapping: {}, provisioning: { creation: "disabled" } }),
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
