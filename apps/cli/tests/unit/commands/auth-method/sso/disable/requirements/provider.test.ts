import { describe, expect, it } from "vitest";

import { schemaTarget } from "../../../../../../../src/commands/auth-method/requirements/target";
import { providerToRemove } from "../../../../../../../src/commands/auth-method/sso/disable/requirements/provider";
import { unmet } from "../../../../../../../src/lib/oclif/requirements";
import { defaultSchema, setUpProject } from "../../../../../../helpers/local-project";
import { requirementContext } from "../../../../../../helpers/requirement-context";

async function targetOf(cwd: string) {
  return schemaTarget.resolve(requirementContext({ meta: { cwd } }));
}

describe("providerToRemove", () => {
  it("is the provider that was named", async () => {
    expect(
      await providerToRemove.resolve(requirementContext({ flags: { provider: "github" } })),
    ).toBe("github");
  });

  it("is unmet when none is named, listing what the schema offers", async () => {
    const target = await targetOf(
      await setUpProject({
        customers: {
          ...defaultSchema,
          "x-auth-methods": {
            sso: {
              enabled: true,
              providers: ["github"],
            },
          },
        },
      }),
    );

    expect(await providerToRemove.resolve(requirementContext({ resolved: { target } }))).toEqual(
      unmet({
        example: "google",
        schema: "customers",
        offered: "github",
      }),
    );
  });

  it("says when the schema offers none", async () => {
    const target = await targetOf(await setUpProject());

    expect(
      await providerToRemove.resolve(requirementContext({ resolved: { target } })),
    ).toMatchObject({
      unmet: {
        offered: "none",
      },
    });
  });

  it("refuses with the next move", () => {
    expect(providerToRemove.refusal).toEqual({
      message: "Name the provider to remove",
      hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
    });
  });
});
