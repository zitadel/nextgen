import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import {
  ACME,
  CONNECTION_PATH,
  FLOW_PATH,
  SCHEMA_FILE,
  SCHEMA_PATH,
  aRequiringSchema,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/impossible-auto-creation-data", () => {
  it.each([
    {
      rule: "sso/impossible-auto-creation-data",
      severity: "warning",
      documents: agreeing(ACME, { schemas: { [SCHEMA_FILE]: aRequiringSchema() } }),
      file: FLOW_PATH,
      message: `step "identifier": "acme" creates users automatically, but a user of ${SCHEMA_PATH} must end up with "phone" and claim_mapping of ${CONNECTION_PATH} maps no claim to it`,
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
      rule: "sso/impossible-auto-creation-data",
      why: "the schema requires nothing the connection leaves unmapped",
      documents: agreeing(ACME),
    },
    {
      rule: "sso/impossible-auto-creation-data",
      why: "the connection maps every required property",
      documents: agreeing(anOidcConnection({ claim_mapping: { email: "email", phone: "phone" } }), {
        schemas: { [SCHEMA_FILE]: aRequiringSchema() },
      }),
    },
    {
      rule: "sso/impossible-auto-creation-data",
      why: "the connection creates no users",
      documents: agreeing(anOidcConnection({ provisioning: { creation: "disabled" } }), {
        schemas: { [SCHEMA_FILE]: aRequiringSchema() },
      }),
    },
    {
      rule: "sso/impossible-auto-creation-data",
      why: "the mapping fills nothing, which sso/empty-claim-mapping reports",
      documents: agreeing(anOidcConnection({ claim_mapping: {} }), {
        schemas: { [SCHEMA_FILE]: aRequiringSchema() },
      }),
    },
    {
      rule: "sso/impossible-auto-creation-data",
      why: "the unmapped property is the one a mistyped target meant, which sso/orphaned-mapping-target reports",
      documents: agreeing(anOidcConnection({ claim_mapping: { email: "email", phon: "phone" } }), {
        schemas: { [SCHEMA_FILE]: aRequiringSchema() },
      }),
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
