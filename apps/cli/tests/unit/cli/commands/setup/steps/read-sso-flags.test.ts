import { describe, expect, it } from "vitest";

import type { SetupFlags } from "@/cli/commands/setup";
import { ReadSsoFlags } from "@/cli/commands/setup/steps/read-sso-flags";
import { asker } from "@/lib/input";
import { aSuggest } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The claim flag that names a property the default schema does not have.
 */
const UNKNOWN_PROPERTY_CLAIM = "notAProperty=employee_id";

/**
 * The flags of a run that names Google, gives its client id and maps a claim.
 *
 * @param claim - What `--sso-claim` carries.
 * @returns The flags, of which only the ones the step reads are set.
 */
function flagsMapping(claim: string): { flags: SetupFlags } {
  return {
    flags: {
      sso: "google",
      ssoClientId: "an-id",
      ssoClaim: [claim],
    } as SetupFlags,
  };
}

/**
 * The step as setup builds it for a run, with nobody to ask or not.
 *
 * @param nonInteractive - Whether nobody can be asked.
 * @returns The step.
 */
function aStep(nonInteractive: boolean): ReadSsoFlags {
  return new ReadSsoFlags({
    ask: asker({ interactive: !nonInteractive, force: false }),
    dryRun: false,
    nonInteractive,
    suggest: aSuggest({}, "1.2.3"),
  });
}

describe("ReadSsoFlags", () => {
  describe("when nobody can be asked", () => {
    it("refuses a claim the schema cannot take before the secret is read", async () => {
      const error = await rejectionOf(() => {
        return aStep(true).run(flagsMapping(UNKNOWN_PROPERTY_CLAIM));
      });

      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("notAProperty"),
      });
    });
  });

  describe("when a person can be asked", () => {
    it("leaves the claims to be held to the schema once its preset is answered", async () => {
      const { ssoFromCommandLine } = await aStep(false).run(flagsMapping(UNKNOWN_PROPERTY_CLAIM));

      expect(ssoFromCommandLine?.claimRequest?.entries).toEqual([
        { attribute: "notAProperty", claim: "employee_id" },
      ]);
    });
  });
});
