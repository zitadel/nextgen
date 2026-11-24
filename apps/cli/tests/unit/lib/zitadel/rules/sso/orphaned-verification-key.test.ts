import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { CONNECTION_FILE, CONNECTION_PATH, agreeing, issuesOf } from "@tests/helpers/sso-rules";

/**
 * The ids of the two rules that judge a verified key.
 */
const VERIFICATION_RULES: readonly string[] = [
  "sso/orphaned-verification-key",
  "sso/unmapped-verification-key",
];

describe("sso/orphaned-verification-key", () => {
  it.each([
    {
      rule: "sso/orphaned-verification-key",
      severity: "error",
      documents: agreeing(anOidcConnection({ verified_claims: { emial: true } })),
      file: CONNECTION_PATH,
      message:
        'verified_claims key "emial" is not a property of any schema that lists "acme" in sso.providers, so it can never verify.',
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
      rule: "sso/orphaned-verification-key",
      documents: agreeing(
        anOidcConnection({ claim_mapping: { email: "email" }, verified_claims: { email: true } }),
      ),
    },
    {
      rule: "sso/orphaned-verification-key",
      documents: {
        connections: {
          [CONNECTION_FILE]: anOidcConnection({ verified_claims: { emial: true } }),
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

  it("says only that a verified key no schema defines is orphaned", () => {
    const documents = agreeing(anOidcConnection({ verified_claims: { emial: true } }));

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(aConfig(documents), {});
    }).filter((issue) => {
      return VERIFICATION_RULES.includes(issue.rule);
    });

    expect(issues).toMatchObject([{ rule: "sso/orphaned-verification-key" }]);
  });
});
