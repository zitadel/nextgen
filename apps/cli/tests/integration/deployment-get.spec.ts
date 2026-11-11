import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const UNKNOWN_DEPLOYMENT = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";
const A_RELEASE = "rel_01M6KPFXAE68N6G2X1HN5XD29R";
const DEPLOYMENT_URL = new RegExp(
  `^http://mock\\.zitadel\\.test/api/v1/deployments/${UNKNOWN_DEPLOYMENT}\\?project_id=proj-`,
);

describe("deployment get", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["deployment", "get", UNKNOWN_DEPLOYMENT, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\//,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(DEPLOYMENT_URL),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["deployment", "get", UNKNOWN_DEPLOYMENT, "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(DEPLOYMENT_URL),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      const deployed = await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["deployment", "get", deployed.deployment_id ?? ""];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reads back a deployment by id", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            id: deployed.deployment_id,
            project_id: expect.stringMatching(/^proj-/),
            release_id: deployed.release_id,
            targets: [{ origin: "http://localhost:3000" }, { origin: "https://app.example.com" }],
            kind: "primary",
            status: "live",
            deployed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            metadata: {
              reason: "deploy",
              message: "test deploy",
              rollback_to: null,
              deployed_by: null,
              deployed_by_type: "service",
            },
          },
          warnings: [],
        });
      });

      it("answers a credential that may not read variables, because it shows none", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();
        platform.refusesVariableReads();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            id: deployed.deployment_id,
            project_id: expect.stringMatching(/^proj-/),
            release_id: deployed.release_id,
            targets: [{ origin: "http://localhost:3000" }, { origin: "https://app.example.com" }],
            kind: "primary",
            status: "live",
            deployed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
            metadata: {
              reason: "deploy",
              message: "test deploy",
              rollback_to: null,
              deployed_by: null,
              deployed_by_type: "service",
            },
          },
          warnings: [],
        });
      });

      it("keeps an origin the server put an escape sequence in as it came", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();
        const origin = platform.servesAHostileOrigin();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            id: deployed.deployment_id,
            project_id: "proj_1",
            release_id: "rel_1",
            targets: [{ origin }],
            kind: "deploy",
            status: "live",
            deployed_at: "2026-01-01T00:00:00Z",
            metadata: { reason: "deploy" },
          },
          warnings: [],
        });
      });

      it("refuses a release id, which is not a deployment id", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "get", A_RELEASE, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: "",
          code: "E_VALIDATION",
          message:
            "Invalid deployment_id: must be a deployment ID: dep_ followed by letters, digits, _ or -",
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("refuses an id holding an escape sequence", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "get", "dep_\u001b[2Jwiped", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: "",
          code: "E_VALIDATION",
          message:
            "Invalid deployment_id: must be a deployment ID: dep_ followed by letters, digits, _ or -",
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("reports an unknown deployment as not found", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "get", UNKNOWN_DEPLOYMENT, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: "deployment: not found",
          details: {
            status: 404,
            url: expect.stringMatching(DEPLOYMENT_URL),
            body: { code: "dep.not_found", message: "deployment: not found" },
          },
        });
      });

      it("stops on Ctrl-C while the server is not answering", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["deployment", "get", UNKNOWN_DEPLOYMENT, "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:get",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("shows the deployment's facts, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
        );

        expect(result).toPrintRow("release_id", deployed.release_id ?? "");
      });

      it.each(RENDERINGS)("names every origin it went to, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
        );

        expect(result).toPrintRow("origins", "http://localhost:3000,", "https://app.acme.com");
      });

      it.each(RENDERINGS)("shows the variables the deployment froze, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
        );

        expect(result).toPrintRow("HOST", "app.acme.com");
      });

      it.each(RENDERINGS)("says when it froze no variables, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
        );

        expect(result).toPrintRow("variables", "none");
      });

      it.each(RENDERINGS)(
        "spells out an escape sequence the server put in an origin, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const deployed = await app.deployData();
          platform.servesAHostileOrigin();

          const result = await asTerminal(() =>
            app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
          );

          expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
          expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
        },
      );

      it("prints the record whole, piped, so a script can read it", async () => {
        const app = await aSetUpApp();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? ""]);

        expect(JSON.parse(result.stdout)).toEqual({
          id: deployed.deployment_id,
          project_id: expect.stringMatching(/^proj-/),
          release_id: deployed.release_id,
          targets: [{ origin: "http://localhost:3000" }],
          kind: "primary",
          status: "live",
          deployed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
          metadata: {
            reason: "deploy",
            message: "Initial deployment from setup",
            rollback_to: null,
            deployed_by: null,
            deployed_by_type: "service",
          },
        });
      });

      it("explains a refusal with the message the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "get", A_RELEASE]);

        expect(result).toSay(
          "Invalid deployment_id: must be a deployment ID: dep_ followed by letters, digits, _ or -",
        );
      });
    });
  });
});
