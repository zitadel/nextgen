import { describe, expect, it } from "vitest";

import { schemaTarget } from "../../../../../../../src/commands/auth-method/requirements/target";
import { removableFlows } from "../../../../../../../src/commands/auth-method/sso/disable/requirements/flows";
import { setUpProject } from "../../../../../../helpers/local-project";
import { requirementContext } from "../../../../../../helpers/requirement-context";

describe("removableFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await schemaTarget.resolve(
      requirementContext({ meta: { cwd: await setUpProject() } }),
    );

    expect(await removableFlows.resolve(requirementContext({ resolved: { target } }))).toHaveLength(
      1,
    );
  });
});
