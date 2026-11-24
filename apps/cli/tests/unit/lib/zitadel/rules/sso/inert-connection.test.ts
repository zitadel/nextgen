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

/**
 * A schema that points at an external one, whose properties and providers are
 * not known here.
 */
const EXTERNAL_SCHEMA = { kind: "schema-url", url: "https://schemas.test.invalid/remote.json" };

describe("sso/inert-connection", () => {
  it.each([
    {
      rule: "sso/inert-connection",
      severity: "warning",
      documents: { connections: { [CONNECTION_FILE]: ACME } },
      file: CONNECTION_PATH,
      message: 'connection "acme" is listed in sso.providers by no schema',
    },
    {
      rule: "sso/inert-connection",
      severity: "warning",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: { [CONNECTION_FILE]: ACME },
      },
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
    {
      rule: "sso/inert-connection",
      why: "a schema lists the connection",
      documents: agreeing(ACME),
    },
    {
      rule: "sso/inert-connection",
      why: "a flow offers the connection, which sso/provider-id reports",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: { [CONNECTION_FILE]: ACME },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      },
    },
    {
      rule: "sso/inert-connection",
      why: "a schema lists a typo of the connection, which sso/connection-resolves reports",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acmee"]) },
        connections: { [CONNECTION_FILE]: ACME },
      },
    },
    {
      rule: "sso/inert-connection",
      why: "a schema is external, so which connections it lists cannot be known",
      documents: {
        schemas: { [SCHEMA_FILE]: EXTERNAL_SCHEMA },
        connections: { [CONNECTION_FILE]: ACME },
      },
    },
  ] satisfies readonly {
    readonly rule: string;
    readonly why: string;
    readonly documents: ConfigDocuments;
  }[])("$rule stays silent: $why", (row) => {
    const issues = issuesOf(row.rule, row.documents);

    expect(issues).toEqual([]);
  });
});
