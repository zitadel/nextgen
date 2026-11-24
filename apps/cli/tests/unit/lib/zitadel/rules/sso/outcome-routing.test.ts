import { describe, expect, it } from "vitest";
import { anOidcConnection, type ConfigDocuments } from "@tests/helpers/config";
import {
  FLOW_FILE,
  FLOW_PATH,
  ACME,
  agreeing,
  aFlowStepping,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/outcome-routing", () => {
  it.each([
    {
      rule: "sso/outcome-routing",
      severity: "error",
      documents: agreeing(ACME, {
        flows: {
          [FLOW_FILE]: aFlowStepping({ transitions: { sso_authenticated: { target: "done" } } }),
        },
      }),
      file: FLOW_PATH,
      message: "does not route sso_user_not_found, user_already_exists. Add a transition for each.",
    },
    {
      rule: "sso/outcome-routing",
      severity: "error",
      documents: agreeing(ACME, {
        flows: {
          [FLOW_FILE]: aFlowStepping({
            transitions: {
              sso_authenticated: { target: "done" },
              sso_user_not_found: { target: "register-sso" },
              user_already_exists: { action: "switch", target: "sso-conflict" },
            },
          }),
        },
      }),
      file: FLOW_PATH,
      message: "does not route user_already_exists. A collision is followed only through",
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
    { rule: "sso/outcome-routing", documents: agreeing(ACME) },
    {
      rule: "sso/outcome-routing",
      documents: agreeing(
        anOidcConnection({
          claim_mapping: { email: "email" },
          provisioning: { creation: "disabled" },
        }),
        {
          flows: {
            [FLOW_FILE]: aFlowStepping({
              transitions: { sso_authenticated: { target: "done" } },
            }),
          },
        },
      ),
    },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );

  it("still asks a step offering a provider with no connection file to route a new user", () => {
    const documents = {
      flows: {
        [FLOW_FILE]: aFlowStepping({ transitions: { sso_authenticated: { target: "done" } } }),
      },
    };

    const issues = issuesOf("sso/outcome-routing", documents);

    expect(issues).toMatchObject([
      {
        message: expect.stringContaining("does not route sso_user_not_found, user_already_exists"),
      },
    ]);
  });
});
