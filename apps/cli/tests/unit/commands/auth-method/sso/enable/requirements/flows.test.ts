import { describe, expect, it } from "vitest";

import { schemaTarget } from "../../../../../../../src/commands/auth-method/requirements/target";
import { ssoFlows } from "../../../../../../../src/commands/auth-method/sso/enable/requirements/flows";
import { unmet } from "../../../../../../../src/lib/oclif/requirements";
import { defaultSchema, makeProject, setUpProject } from "../../../../../../helpers/local-project";
import { requirementContext } from "../../../../../../helpers/requirement-context";

async function targetOf(cwd: string) {
  return schemaTarget.resolve(requirementContext({ meta: { cwd } }));
}

describe("ssoFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await targetOf(await setUpProject());

    expect(await ssoFlows.resolve(requirementContext({ resolved: { target } }))).toHaveLength(1);
  });

  it("is unmet for a schema no login flow runs against", async () => {
    const target = await targetOf(await makeProject({ schemas: { customers: defaultSchema } }));

    expect(await ssoFlows.resolve(requirementContext({ resolved: { target } }))).toEqual(
      unmet({
        schema: "customers",
        path: ".zitadel/schemas/customers.json",
      }),
    );
  });

  it("refuses that as not found, naming the schema", () => {
    expect(ssoFlows.refusal).toMatchObject({
      code: "E_NOT_FOUND",
      message: "No login flow runs against {schema}",
    });
  });
});
