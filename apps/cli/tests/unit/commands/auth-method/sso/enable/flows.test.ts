import { describe, expect, it } from "vitest";

import { readSchemaTarget } from "../../../../../../src/commands/auth-method/command";
import { ssoFlows } from "../../../../../../src/commands/auth-method/sso/enable/index";
import { defaultSchema, makeProject, setUpProject } from "../../../../../helpers/local-project";

function targetOf(cwd: string) {
  return readSchemaTarget({
    cwd,
    schema: undefined,
    cwdGiven: false,
  });
}

describe("ssoFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await targetOf(await setUpProject());

    expect(ssoFlows(target)).toHaveLength(1);
  });

  it("refuses a schema no login flow runs against, naming it", async () => {
    const target = await targetOf(await makeProject({ schemas: { customers: defaultSchema } }));

    expect(() => {
      ssoFlows(target);
    }).toThrow(
      expect.objectContaining({
        code: "E_NOT_FOUND",
        message: "No login flow runs against customers",
        details: {
          schema: ".zitadel/schemas/customers.json",
        },
      }),
    );
  });
});
