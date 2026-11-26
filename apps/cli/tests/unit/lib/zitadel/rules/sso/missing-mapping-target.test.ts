import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aSchemaListing } from "@tests/helpers/schemas";
import {
  ACME,
  CONNECTION_PATH,
  SCHEMA_FILE,
  agreeing,
  issuesOf,
  twoSchemas,
} from "@tests/helpers/sso-rules";

/**
 * Where the schema that defines no `email` sits, as one of the two
 * {@link twoSchemas}.
 */
const NO_EMAIL_PATH = ".zitadel/schemas/field.json";

describe("sso/missing-mapping-target", () => {
  it.each([
    {
      rule: "sso/missing-mapping-target",
      severity: "warning",
      documents: agreeing(ACME, { schemas: twoSchemas() }),
      file: CONNECTION_PATH,
      message: `claim_mapping target "email" is not a property of ${NO_EMAIL_PATH}, which list "acme" in sso.providers`,
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
      rule: "sso/missing-mapping-target",
      why: "the one schema that lists the connection defines the target",
      documents: agreeing(ACME),
    },
    {
      rule: "sso/missing-mapping-target",
      why: "the schema that lacks the target does not list the connection",
      documents: agreeing(ACME, {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]), "field.json": aSchemaListing([]) },
      }),
    },
    {
      rule: "sso/missing-mapping-target",
      why: "no listing schema defines the target, which sso/orphaned-mapping-target reports",
      documents: agreeing(anOidcConnection({ claim_mapping: { emial: "email" } }), {
        schemas: twoSchemas(),
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
