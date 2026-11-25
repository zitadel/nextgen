import { describe, expect, it } from "vitest";

import { ChooseProvider } from "@/cli/commands/auth-method/sso/enable/steps/choose-provider";
import { ZitadelError } from "@/lib/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * What the step reads from what the run starts from.
 */
type Needs = Parameters<ChooseProvider["run"]>[0];

/**
 * A run with nobody to ask.
 */
const SCRIPTED = { dryRun: false, nonInteractive: true };

/**
 * A run by a person at a terminal.
 */
const AT_A_TERMINAL = { dryRun: false, nonInteractive: false };

/**
 * What the step reads for the flags given.
 *
 * @param flags - The provider and custom-connection flags the run was given.
 * @returns What the step reads.
 */
function needsFor(flags: Partial<Needs["flags"]>): Needs {
  return { flags: flags as Needs["flags"] };
}

describe("ChooseProvider", () => {
  it("is a catalog provider by its name", async () => {
    const { choice } = await new ChooseProvider(SCRIPTED).run(needsFor({ provider: "google" }));

    expect(choice).toMatchObject({ selection: { kind: "catalog" } });
  });

  it("refuses an unknown provider", async () => {
    const error = await rejectionOf(() => {
      return new ChooseProvider(SCRIPTED).run(needsFor({ provider: "nope" }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION", message: "Unknown provider nope" });
  });

  it("refuses a custom setting beside a catalog provider", async () => {
    const error = await rejectionOf(() => {
      return new ChooseProvider(SCRIPTED).run(needsFor({ provider: "google", slug: "acme" }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("holds a script to the flags and names the ones a custom connection lacks", async () => {
    const error = await rejectionOf(() => {
      return new ChooseProvider(SCRIPTED).run(needsFor({ provider: "custom", slug: "acme" }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      details: { missing: ["--display-name", "--issuer"] },
    });
  });

  it("leaves a person at a terminal to be asked for the settings they left out", async () => {
    const { choice } = await new ChooseProvider(AT_A_TERMINAL).run(
      needsFor({ provider: "custom", slug: "acme" }),
    );

    expect(choice).toMatchObject({ selection: undefined, values: { slug: "acme" } });
  });
});
