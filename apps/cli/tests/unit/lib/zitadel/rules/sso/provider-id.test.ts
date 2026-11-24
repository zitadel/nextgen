import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing, HUMAN_USER } from "@tests/helpers/schemas";
import {
  SCHEMA_FILE,
  SCHEMA_PATH,
  FLOW_FILE,
  FLOW_PATH,
  CONNECTION_FILE,
  SCHEMA_ID,
  ACME,
} from "@tests/helpers/sso-rules";

describe("sso/provider-id", () => {
  it("refuse a provider the pinned schema does not list, naming the flow file and its step", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: ACME },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toContainEqual({
      severity: "error",
      rule: "sso/provider-id",
      file: FLOW_PATH,
      steps: ["identifier"],
      message: `step "identifier": sso provider "acme" is not listed in sso.providers of ${SCHEMA_PATH}. Add it there, or remove it from the flow.`,
    });
  });

  it("refuse a provider the schema does not list when only a broken connection file holds it", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: anOidcConnection({ display_name: undefined }) },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(
      issues.filter((issue) => {
        return issue.rule === "sso/provider-id" && issue.file === FLOW_PATH;
      }),
    ).toHaveLength(1);
  });

  describe("when finding the schema a flow pins", () => {
    it.each([
      ["objectType", aSchemaListing(["other"]), HUMAN_USER],
      ["$id", aSchemaListing(["other"], { $id: SCHEMA_ID }), SCHEMA_ID],
    ])("matches a flow's user_schema to a schema's %s", (_key, schema, userSchema) => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: schema },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], userSchema) },
        connections: { [CONNECTION_FILE]: ACME },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(expect.objectContaining({ rule: "sso/provider-id" }));
    });
  });
});
