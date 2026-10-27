import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const TOO_SHORT = {
  name: "too short",
  input: { password: "short1" },
  expect: { allowed: false, violations: ["min_length"] },
};
const LONG_ENOUGH = {
  name: "long enough",
  input: { password: "a-long-enough-one" },
  expect: { allowed: true },
};

/** Build a release of the project as it is and return its id. */
async function aRelease(app: ScaffoldedApp): Promise<string> {
  const result = await app.run(["release", "create", "--non-interactive", "--json"]);
  expect(result, "arranging a release should have succeeded").toSucceed();
  return app.envelopeOf<{ release_id: string }>(result).data.release_id;
}

describe("policies test", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);
        platform.isNotZitadel();

        const result = await app.testPolicies(["--json"]);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);
        platform.isUnavailable();

        const result = await app.testPolicies(["--json"]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("passes when every case holds for the policy file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([TOO_SHORT, LONG_ENOUGH]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toSucceed();
      });

      it("fails when a case does not hold for the policy file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({});
        await app.writePolicyTest([TOO_SHORT]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("tests the policy a release pins, not the file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        const releaseId = await aRelease(app);
        await app.writePasswordPolicy({});
        await app.writePolicyTest([TOO_SHORT]);

        const result = await app.testPolicies(["--release", releaseId, "--json"]);

        expect(result).toSucceed();
      });

      it("tests a release that pins no policy as enforcing nothing", async () => {
        const app = await aSetUpApp();
        await app.removePasswordPolicy();
        const releaseId = await aRelease(app);
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies(["--release", releaseId, "--json"]);

        expect(result).toSucceed();
      });

      it("refuses a test file a case of which names an unknown input", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([{ ...LONG_ENOUGH, input: { passwd: "x" } }]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("skips a project without test files", async () => {
        const app = await aSetUpApp();

        const result = await app.testPolicies(["--json"]);

        expect(result).toBeSkipped();
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the totals", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([TOO_SHORT, LONG_ENOUGH]);

        const result = await app.testPolicies();

        expect(result).toPrint("2 passed");
      });

      it("shows the failing case with the error", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies();

        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain(`✗ ${TOO_SHORT.name}: expected allowed, got refused`);
      });
    });
  });
});
