import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import {
  ACME,
  CONNECTION_FILE,
  CONNECTION_PATH,
  FLOW_FILE,
  FLOW_PATH,
  SCHEMA_FILE,
  SCHEMA_PATH,
  agreeing,
  issuesOf,
  twoSchemas,
} from "@tests/helpers/sso-rules";

describe("sso/empty-verified-claims", () => {
  it.each([
    {
      rule: "sso/empty-verified-claims",
      severity: "warning",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email", phone: "phone" },
          verified_claims: { phone: true },
        }),
        { schemas: twoSchemas() },
      ),
      file: FLOW_PATH,
      message: `verified_claims of "acme" (${CONNECTION_PATH}) names nothing ${SCHEMA_PATH} defines`,
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
      rule: "sso/empty-verified-claims",
      why: "the connection verifies nothing",
      documents: agreeing(ACME),
    },
    {
      rule: "sso/empty-verified-claims",
      why: "the flow's schema does not list the connection, which sso/provider-id reports",
      documents: {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
        connections: {
          [CONNECTION_FILE]: anOidcConnection({
            claim_mapping: { email: "email", phone: "phone" },
            verified_claims: { phone: true },
          }),
        },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      },
    },
    {
      rule: "sso/empty-verified-claims",
      why: "the connection verifies a property the flow's schema defines",
      documents: agreeing(
        anOidcConnection({ claim_mapping: { email: "email" }, verified_claims: { email: true } }),
      ),
    },
    {
      rule: "sso/empty-verified-claims",
      why: "the connection creates no users",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email", phone: "phone" },
          verified_claims: { phone: true },
          provisioning: { creation: "disabled" },
        }),
        { schemas: twoSchemas() },
      ),
    },
    {
      rule: "sso/empty-verified-claims",
      why: "no listing schema defines the key, which sso/orphaned-verification-key reports",
      documents: agreeing(anOidcConnection({ verified_claims: { emial: true } })),
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
