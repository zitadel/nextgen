import { describe, expect, it } from "vitest";

import {
  providerToRemove,
  removableFlows,
} from "../../../../../../src/commands/auth-method/sso/disable/index";
import { readSchemaTarget } from "../../../../../../src/commands/auth-method/command";
import { defaultSchema, setUpProject } from "../../../../../helpers/local-project";

function targetOf(cwd: string) {
  return readSchemaTarget({
    cwd,
    schema: undefined,
    cwdGiven: false,
  });
}

describe("providerToRemove", () => {
  it("is the provider that was named", async () => {
    const target = await targetOf(await setUpProject());

    expect(providerToRemove("github", target)).toBe("github");
  });

  it("refuses when none is named, listing what the schema offers", async () => {
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

    expect(() => {
      providerToRemove(undefined, target);
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Name the provider to remove",
        hint: "Pass --provider, e.g. --provider google. customers offers: github.",
      }),
    );
  });

  it("says when the schema offers none", async () => {
    const target = await targetOf(await setUpProject());

    expect(() => {
      providerToRemove(undefined, target);
    }).toThrow(
      expect.objectContaining({
        hint: expect.stringContaining("offers: none"),
      }),
    );
  });
});

describe("removableFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await targetOf(await setUpProject());

    expect(removableFlows(target)).toHaveLength(1);
  });
});
