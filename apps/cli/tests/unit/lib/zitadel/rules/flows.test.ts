import { describe, expect, it } from "vitest";

import { type Issue, ZitadelConfig } from "@/lib/zitadel";
import { FLOW_RULES } from "@/lib/zitadel/rules/flows";

/**
 * Where the flow in these tests sits.
 */
const FLOW = ".zitadel/flows/login.json";

/**
 * A flow naming `userSchema` whose one step offers `providers`.
 *
 * @param userSchema - What the flow's `user_schema` names.
 * @param providers - The providers the step offers.
 * @returns The flow's file.
 */
function flow(userSchema: string, providers: readonly string[]) {
  return {
    path: FLOW,
    body: {
      user_schema: userSchema,
      steps: [{ name: "identifier", sso_providers: providers }],
    },
  };
}

/**
 * The `flow/unpinned-schema` findings for a configuration holding a `staff`
 * schema and one flow.
 *
 * @param file - The flow's file.
 * @returns The findings.
 */
function unpinned(file: ReturnType<typeof flow>): readonly Issue[] {
  const config = ZitadelConfig.of({
    schemas: [{ path: ".zitadel/schemas/staff.json", body: { objectType: "staff" } }],
    flows: [file],
    connections: [],
    policies: [],
    branding: [],
  });
  return FLOW_RULES.flatMap((rule) => {
    return rule.check(config, {});
  }).filter((issue) => {
    return issue.rule === "flow/unpinned-schema";
  });
}

describe("FLOW_RULES", () => {
  describe("flow/unpinned-schema", () => {
    it("warns about a flow offering a provider that pins no local schema", () => {
      expect(unpinned(flow("customers", ["google"]))).toEqual([
        {
          severity: "warning",
          rule: "flow/unpinned-schema",
          file: FLOW,
          message:
            "could not tell which local schema this flow pins, so its provider rules were not checked against a schema",
        },
      ]);
    });

    it("stays quiet about a flow that pins a local schema", () => {
      expect(unpinned(flow("staff", ["google"]))).toEqual([]);
    });

    it("stays quiet about a flow that offers no provider", () => {
      expect(unpinned(flow("customers", []))).toEqual([]);
    });
  });
});
