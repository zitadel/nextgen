import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/zitadel";
import { isJsonObject, listAt } from "@/lib/zitadel/utils/json";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import { aFlowOffering } from "@tests/helpers/schemas";
import {
  ACME,
  CONNECTION_PATH,
  FLOW_FILE,
  FLOW_PATH,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

/**
 * A flow whose login entry offers nothing and whose register entry offers
 * `acme`; or, when `shared`, one entry that serves both purposes.
 *
 * @param shared - Whether one step is the entry of both purposes.
 * @returns The flow document.
 */
function aRegisteringFlow(shared: boolean = false): JsonObject {
  const offering = aFlowOffering(["acme"]);
  const entry = listAt(offering, "steps")[0];
  const identifier = isJsonObject(entry) ? entry : {};
  if (shared) {
    return { ...offering, purposes: { login: "identifier", register: "identifier" } };
  }
  return {
    ...offering,
    purposes: { login: "identifier", register: "register" },
    steps: [
      { ...identifier, sso_providers: [] },
      { ...identifier, name: "register" },
    ],
  };
}

describe("sso/impossible-registration", () => {
  it.each([
    {
      rule: "sso/impossible-registration",
      severity: "warning",
      documents: agreeing(anOidcConnection({ provisioning: { creation: "disabled" } }), {
        flows: { [FLOW_FILE]: aRegisteringFlow() },
      }),
      file: FLOW_PATH,
      message: `step "register": "acme" offers registration, but provisioning.creation of ${CONNECTION_PATH} is "disabled"`,
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
    { rule: "sso/impossible-registration", documents: agreeing(ACME) },
    {
      rule: "sso/impossible-registration",
      documents: agreeing(ACME, { flows: { [FLOW_FILE]: aRegisteringFlow() } }),
    },
    {
      rule: "sso/impossible-registration",
      documents: agreeing(anOidcConnection({ provisioning: { creation: "disabled" } })),
    },
    {
      rule: "sso/impossible-registration",
      documents: agreeing(anOidcConnection({ provisioning: { creation: "disabled" } }), {
        flows: { [FLOW_FILE]: aRegisteringFlow(true) },
      }),
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );
});
