import { describe, expect, it } from "vitest";
import type { ConfigDocuments } from "@tests/helpers/config";
import { aFlowOffering } from "@tests/helpers/schemas";
import { ACME, FLOW_FILE, SCHEMA_PATH, agreeing, issuesOf } from "@tests/helpers/sso-rules";

describe("sso/dead-capability", () => {
  it("warns of a provider a schema lists that no flow running against it offers, naming the schema", () => {
    const documents = agreeing(ACME, { flows: { [FLOW_FILE]: aFlowOffering([]) } });

    const issues = issuesOf("sso/dead-capability", documents);

    expect(issues).toEqual([
      {
        severity: "warning",
        rule: "sso/dead-capability",
        file: SCHEMA_PATH,
        slug: "acme",
        message: expect.stringContaining('sso.providers lists "acme" but no flow'),
      },
    ]);
  });

  it.each([
    { where: "a flow offers it", documents: agreeing(ACME) },
    {
      where: "no flow runs against the schema",
      documents: agreeing(ACME, { flows: { [FLOW_FILE]: aFlowOffering(["acme"], "elsewhere") } }),
    },
    {
      where: "no flow exists",
      documents: { schemas: agreeing(ACME).schemas, connections: agreeing(ACME).connections },
    },
    {
      where: "it has no connection file",
      documents: agreeing(ACME, { connections: {}, flows: { [FLOW_FILE]: aFlowOffering([]) } }),
    },
  ] satisfies readonly {
    readonly where: string;
    readonly documents: ConfigDocuments;
  }[])("does not warn of a listed provider when $where", ({ documents }) => {
    const issues = issuesOf("sso/dead-capability", documents);

    expect(issues).toEqual([]);
  });
});
