import { describe, expect, it } from "vitest";
import type { ConfigDocuments } from "@tests/helpers/config";
import {
  FLOW_FILE,
  FLOW_PATH,
  ACME,
  agreeing,
  aFlowStepping,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/collection-conflict-routing", () => {
  it.each([
    {
      rule: "sso/collection-conflict-routing",
      severity: "error",
      documents: agreeing(ACME, {
        flows: {
          [FLOW_FILE]: aFlowStepping({
            on_success: "create_user_with_sso",
            transitions: {
              sso_authenticated: { target: "done" },
              sso_user_not_found: { target: "register-sso" },
            },
          }),
        },
      }),
      file: FLOW_PATH,
      message:
        "on_success create_user_with_sso must route user_already_exists. Add that transition.",
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
    { rule: "sso/collection-conflict-routing", documents: agreeing(ACME) },
  ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
    "$rule stays silent on a project that does not break it",
    (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toEqual([]);
    },
  );
});
