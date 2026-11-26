import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import {
  CONNECTION_FILE,
  CONNECTION_PATH,
  ACME,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/orphaned-mapping-target", () => {
  it.each([
    {
      rule: "sso/orphaned-mapping-target",
      severity: "error",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { emial: "email" },
          oidc: { scopes: ["openid", "email"] },
        }),
      ),
      file: CONNECTION_PATH,
      message:
        'claim_mapping target "emial" is not a property of any schema that lists "acme" in sso.providers. Did you mean',
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
    { rule: "sso/orphaned-mapping-target", documents: agreeing(ACME) },
    {
      rule: "sso/orphaned-mapping-target",
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
});
