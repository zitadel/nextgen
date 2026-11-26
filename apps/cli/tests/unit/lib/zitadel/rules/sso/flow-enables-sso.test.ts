import { describe, expect, it } from "vitest";
import { aUserSchema, type ConfigDocuments } from "@tests/helpers/config";
import {
  SCHEMA_FILE,
  SCHEMA_PATH,
  FLOW_PATH,
  ACME,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/flow-enables-sso", () => {
  it.each([
    {
      rule: "sso/flow-enables-sso",
      severity: "error",
      documents: agreeing(ACME, { schemas: { [SCHEMA_FILE]: aUserSchema() } }),
      file: FLOW_PATH,
      message: `offers sso_providers but "sso" is not an enabled authentication method in ${SCHEMA_PATH}`,
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

  it.each([{ rule: "sso/flow-enables-sso", documents: agreeing(ACME) }] satisfies readonly {
    readonly rule: string;
    readonly documents: ConfigDocuments;
  }[])("$rule stays silent on a project that does not break it", (row) => {
    const issues = issuesOf(row.rule, row.documents);

    expect(issues).toEqual([]);
  });
});
