import { describe, expect, it } from "vitest";
import { UnparsedFile, ZitadelConfig } from "@/lib/zitadel";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection, configFiles } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import {
  SCHEMA_FILE,
  SCHEMA_PATH,
  FLOW_FILE,
  CONNECTION_FILE,
  CONNECTION_PATH,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/connection-resolves", () => {
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

  it.each([
    {
      where: "a schema lists it",
      documents: { schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } },
    },
    {
      where: "a flow offers it",
      documents: { flows: { [FLOW_FILE]: aFlowOffering(["acme"]) } },
    },
  ])(
    "leave a slug held by a connection file its contract refuses to that file's own findings when $where",
    ({ documents }) => {
      const config = aConfig({
        ...documents,
        connections: { [CONNECTION_FILE]: anOidcConnection({ display_name: undefined }) },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
      expect(
        issues.filter((issue) => {
          return issue.rule === "sso/connection-resolves";
        }),
      ).toEqual([]);
    },
  );

  it.each([
    {
      where: "a schema lists it",
      documents: { schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } },
    },
    {
      where: "a flow offers it",
      documents: { flows: { [FLOW_FILE]: aFlowOffering(["acme"]) } },
    },
  ])(
    "leave a slug named by a connection file that cannot be parsed to that file's own findings when $where",
    ({ documents }) => {
      const config = ZitadelConfig.of({
        ...configFiles(documents),
        connections: [UnparsedFile.invalidJson(CONNECTION_PATH, "{ not json")],
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
      expect(
        issues.filter((issue) => {
          return issue.rule === "sso/connection-resolves";
        }),
      ).toEqual([]);
    },
  );

  it("leave a slug named by a broken connection file with no slug to that file's own findings", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
      connections: { [CONNECTION_FILE]: anOidcConnection({ slug: undefined }) },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
    expect(
      issues.filter((issue) => {
        return issue.rule === "sso/connection-resolves";
      }),
    ).toEqual([]);
  });

  it("reports a connection both a schema and a flow name once, on the schema", () => {
    const documents = {
      schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
    };

    const issues = issuesOf("sso/connection-resolves", documents);

    expect(issues).toMatchObject([{ file: SCHEMA_PATH, slug: "acme" }]);
  });
});
