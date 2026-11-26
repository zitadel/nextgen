import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import { SCHEMA_FILE, FLOW_FILE, CONNECTION_FILE, ACME } from "@tests/helpers/sso-rules";

describe("SSO_RULES", () => {
  it("find nothing in a project whose files agree", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: ACME },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([]);
  });

  it("find nothing in a project with no SSO files at all", () => {
    const config = aConfig();

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([]);
  });

  it("report every problem, one issue each", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["acme", "ghost"]) } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toMatchObject([{ slug: "acme" }, { slug: "ghost" }]);
  });

  describe("when finding the schema a flow pins", () => {
    it("does not hold a flow to a schema the project does not keep locally", () => {
      const config = aConfig({
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], "not-kept-here") },
        connections: { [CONNECTION_FILE]: ACME },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toEqual([]);
    });
  });
});
