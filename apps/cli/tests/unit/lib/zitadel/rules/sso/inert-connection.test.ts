import { describe, expect, it } from "vitest";
import type { ConfigDocuments } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import {
  ACME,
  CONNECTION_FILE,
  CONNECTION_PATH,
  FLOW_FILE,
  SCHEMA_FILE,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/inert-connection", () => {
  it.each([
    {
      rule: "sso/inert-connection",
      severity: "warning",
      documents: { connections: { [CONNECTION_FILE]: ACME } },
      file: CONNECTION_PATH,
      message: 'connection "acme" is listed in sso.providers by no schema',
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
    { rule: "sso/inert-connection", documents: agreeing(ACME) },
    {
      rule: "sso/inert-connection",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: { [CONNECTION_FILE]: ACME },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      },
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );

  it("does not call a deployed connection inert when no schema lists it", () => {
    const issues = issuesOf(
      "sso/inert-connection",
      { connections: { [CONNECTION_FILE]: ACME } },
      { deployed: new Set(["acme"]) },
    );

    expect(issues).toEqual([]);
  });
});
