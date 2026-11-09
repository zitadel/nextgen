import { describe, expect, it } from "vitest";

import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing, HUMAN_USER } from "@tests/helpers/schemas";

/**
 * The file name of the schema in these tests.
 */
const SCHEMA_FILE = "staff.json";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The file name of the flow in these tests.
 */
const FLOW_FILE = "login.json";

/**
 * Where the flow in these tests sits.
 */
const FLOW_PATH = `.zitadel/flows/${FLOW_FILE}`;

/**
 * The file name of the connection in these tests.
 */
const CONNECTION_FILE = "acme.json";

/**
 * Where the connection in these tests sits.
 */
const CONNECTION_PATH = `.zitadel/idps/${CONNECTION_FILE}`;

/**
 * The file name of a second connection claiming the same slug.
 */
const COPY_FILE = "copy.json";

/**
 * The `$id` a schema and the flow pinning it may both name.
 */
const SCHEMA_ID = "https://schemas.example.test/staff.json";

/**
 * The connection the schema and flow name, mapping the email claim it asks
 * for.
 */
const ACME = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"] },
});

/**
 * A second connection claiming {@link ACME}'s slug, with a secret of its own.
 */
const ACME_COPY = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"], client_secret: "${{ COPY_CLIENT_SECRET }}" },
});

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

  it("refuse a schema that lists a provider with no connection file, naming the schema", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/connection-resolves",
        file: SCHEMA_PATH,
        slug: "acme",
        message:
          'sso.providers lists "acme" but there is no connection file with that slug under .zitadel/idps/. Add the file, or remove "acme" from sso.providers.',
      },
    ]);
  });

  it("refuse a second connection file that claims a slug, naming the first", () => {
    const config = aConfig({ connections: { [CONNECTION_FILE]: ACME, [COPY_FILE]: ACME_COPY } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/duplicate-slug",
        file: `.zitadel/idps/${COPY_FILE}`,
        message: `connection slug "acme" is also used by ${CONNECTION_PATH}. A slug names one connection: change the slug here, or delete one of the two files.`,
      },
    ]);
  });

  it("report every problem, one issue each", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["acme", "ghost"]) } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toMatchObject([{ slug: "acme" }, { slug: "ghost" }]);
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

  describe("when a connection verifies a key it does not map", () => {
    /**
     * A connection verifying `email` while mapping nothing.
     */
    const UNMAPPED = anOidcConnection({ verified_claims: { email: "email_verified" } });

    it("refuses it when a schema lists the connection", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("refuses it when a flow offers the connection", () => {
      const config = aConfig({
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], "not-kept-here") },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("leaves it alone when nothing lists or offers the connection", () => {
      const config = aConfig({ connections: { [CONNECTION_FILE]: UNMAPPED } });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      }).filter((issue) => {
        return issue.rule === "sso/unmapped-verification-key";
      });

      expect(issues).toEqual([]);
    });
  });
});
