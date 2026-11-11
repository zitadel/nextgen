import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

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

const EVALUATE_URL = /^http:\/\/mock\.zitadel\.test\/api\/v1\/policies\/evaluate\?project_id=proj-/;
const POLICY_FILE = ".zitadel/policies/auth.factor.password.set.json";
const TEST_FILE = ".zitadel/policies/auth.factor.password.set.test.json";
const TOO_SHORT_REFUSED = {
  allowed: false,
  code: "user.password_policy_violation",
  violations: { min_length: 12 },
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

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/policies\/evaluate\?project_id=proj-\S+ returned 404 .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(EVALUATE_URL),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);
        platform.isUnavailable();

        const result = await app.testPolicies(["--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(EVALUATE_URL),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["policies", "test"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("passes when every case holds for the policy file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([TOO_SHORT, LONG_ENOUGH]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "2 passed",
            source: "files",
            operations: [
              {
                operation: "auth.factor.password.set",
                file: TEST_FILE,
                policy: { file: POLICY_FILE },
                cases: [
                  {
                    name: "too short",
                    passed: true,
                    expected: { allowed: false, violations: ["min_length"] },
                    actual: TOO_SHORT_REFUSED,
                  },
                  {
                    name: "long enough",
                    passed: true,
                    expected: { allowed: true },
                    actual: { allowed: true },
                  },
                ],
              },
            ],
            passed: 2,
            failed: 0,
          },
          warnings: [],
        });
      });

      it("fails when a case does not hold for the policy file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "1 of 1 policy test cases failed",
          hint: `auth.factor.password.set  (${POLICY_FILE})\n  ✗ too short: expected allowed, got refused (user.password_policy_violation: min_length)\n\n0 passed, 1 failed`,
          details: {
            source: "files",
            operations: [
              {
                operation: "auth.factor.password.set",
                file: TEST_FILE,
                policy: { file: POLICY_FILE },
                cases: [
                  {
                    name: "too short",
                    passed: false,
                    expected: { allowed: true },
                    actual: TOO_SHORT_REFUSED,
                  },
                ],
              },
            ],
            passed: 0,
            failed: 1,
          },
        });
      });

      it("tests the policy a release pins, not the file", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        const releaseId = await aRelease(app);
        await app.writePasswordPolicy({});
        await app.writePolicyTest([TOO_SHORT]);

        const result = await app.testPolicies(["--release", releaseId, "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "1 passed",
            source: "release",
            release_id: releaseId,
            operations: [
              {
                operation: "auth.factor.password.set",
                file: TEST_FILE,
                policy: { revision_id: expect.stringMatching(/^polrev_/) },
                cases: [
                  {
                    name: "too short",
                    passed: true,
                    expected: { allowed: false, violations: ["min_length"] },
                    actual: TOO_SHORT_REFUSED,
                  },
                ],
              },
            ],
            passed: 1,
            failed: 0,
          },
          warnings: [],
        });
      });

      it("tests a release that pins no policy as enforcing nothing", async () => {
        const app = await aSetUpApp();
        await app.removePasswordPolicy();
        const releaseId = await aRelease(app);
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies(["--release", releaseId, "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "1 passed",
            source: "release",
            release_id: releaseId,
            operations: [
              {
                operation: "auth.factor.password.set",
                file: TEST_FILE,
                policy: null,
                cases: [
                  {
                    name: "too short",
                    passed: true,
                    expected: { allowed: true },
                    actual: { allowed: true },
                  },
                ],
              },
            ],
            passed: 1,
            failed: 0,
          },
          warnings: [],
        });
      });

      it("keeps a case name holding an escape sequence as it was written", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, name: "bad\u001b[2Jname" }]);

        const result = await app.testPolicies(["--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "1 passed",
            source: "files",
            operations: [
              {
                operation: "auth.factor.password.set",
                file: TEST_FILE,
                policy: { file: POLICY_FILE },
                cases: [
                  {
                    name: "bad\u001b[2Jname",
                    passed: true,
                    expected: { allowed: false, violations: ["min_length"] },
                    actual: TOO_SHORT_REFUSED,
                  },
                ],
              },
            ],
            passed: 1,
            failed: 0,
          },
          warnings: [],
        });
      });

      it("refuses a test file a case of which names an unknown input", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([{ ...LONG_ENOUGH, input: { passwd: "x" } }]);

        const result = await app.testPolicies(["--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "The policy test files are not valid",
          hint: `${TEST_FILE}: cases.0.input.password Invalid input: expected string, received undefined\n${TEST_FILE}: cases.0.input Unrecognized key: "passwd"`,
          details: {
            issues: [
              `${TEST_FILE}: cases.0.input.password Invalid input: expected string, received undefined`,
              `${TEST_FILE}: cases.0.input Unrecognized key: "passwd"`,
            ],
          },
        });
      });

      it("skips a project without test files", async () => {
        const app = await aSetUpApp();

        const result = await app.testPolicies(["--json"]);

        expect(result).toBeSkipped();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          status: "skipped",
          reason: "no-policy-tests",
          data: { title: "No policy test files in .zitadel/policies" },
        });
      });

      it("reports a release it cannot find as not found", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);

        const result = await app.testPolicies(["--release", "rel_nope", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "release: not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/releases\/rel_nope\?project_id=proj-/,
            ),
            body: { code: "rel.not_found", message: "release: not found" },
          },
        });
      });

      it("stops on Ctrl-C while the server is not answering", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);
        const waiting = platform.hangs();

        const result = app.testPolicies(["--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "policies:test",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([LONG_ENOUGH]);

        const result = await app.testPolicies(["--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("prints the totals, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([TOO_SHORT, LONG_ENOUGH]);

        const result = await asTerminal(() =>
          app.run(["policies", "test", "--non-interactive"], colour),
        );

        expect(result).toPrint("2 passed");
      });

      it("names the operation and the policy file it tested, piped", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([TOO_SHORT]);

        const result = await app.testPolicies();

        expect(result).toPrint(`auth.factor.password.set  (${POLICY_FILE})`);
      });

      it("names the release it tested, piped", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        await app.writePolicyTest([TOO_SHORT]);

        const result = await app.testPolicies(["--release", releaseId]);

        expect(result).toPrint(`(release ${releaseId}, revision `);
      });

      it("says when a release pins no policy, piped", async () => {
        const app = await aSetUpApp();
        await app.removePasswordPolicy();
        const releaseId = await aRelease(app);
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies(["--release", releaseId]);

        expect(result).toPrint(`(release ${releaseId} pins no policy, nothing enforced)`);
      });

      it("shows the failing case with the error", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies();

        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain(`✗ ${TOO_SHORT.name}: expected allowed, got refused`);
      });

      it("shows the failing case once", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, expect: { allowed: true } }]);

        const result = await app.testPolicies();

        expect(result).toSayOnce(`✗ ${TOO_SHORT.name}: expected allowed, got refused`);
      });

      it("spells out an escape sequence in a case name", async () => {
        const app = await aSetUpApp();
        await app.writePasswordPolicy({ min_length: 12 });
        await app.writePolicyTest([{ ...TOO_SHORT, name: "bad\u001b[2Jname" }]);

        const result = await app.testPolicies();

        expect(result).toPrint("✓ bad\\x1b[2Jname");
        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
      });

      it("says what to add when there are no test files", async () => {
        const app = await aSetUpApp();

        const result = await app.testPolicies();

        expect(result).toPrint(
          "No policy test files in .zitadel/policies/. Add <operation>.test.json beside a policy; .zitadel/policies/README.md shows one.",
        );
      });

      it("explains a refused test file with the message the envelope carries", async () => {
        const app = await aSetUpApp();
        await app.writePolicyTest([{ ...LONG_ENOUGH, input: { passwd: "x" } }]);

        const result = await app.testPolicies();

        expect(result).toSay("The policy test files are not valid");
      });
    });
  });
});
