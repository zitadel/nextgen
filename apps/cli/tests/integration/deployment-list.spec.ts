import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  anUndeployedEnvironment,
  aSetUpApp,
  MOCK_SERVER_URL,
  SETUP_ORIGIN,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, RENDERINGS } from "@tests/helpers/terminal";
import { PREVIEW_PATTERN, PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";

const platform = usePlatformMock();

const DEFAULT_ENVIRONMENT = "development";
const DEPLOYMENTS_URL = /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-/;
const DEPLOYMENT_ID = /^dep_[a-zA-Z0-9_-]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

describe("deployment list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(/^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments/),
          details: {
            status: 404,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(DEPLOYMENTS_URL),
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
      await app.deployData();
      platform.servesAHostileOrigin();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["deployment", "list", "--json"] : ["deployment", "list"], how.env),
      );
    });

    describe("--json", () => {
      it("is empty before anything is deployed", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.run(["deployment", "list", "--env", "staging", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "No deployments found",
            items: [],
            count: 0,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("emits the canonical list envelope, newest first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 2 deployments",
            items: [
              {
                id: deployed.deployment_id,
                project_id: expect.stringMatching(/^proj-/),
                release_id: deployed.release_id,
                targets: [{ origin: SETUP_ORIGIN.pattern }, { origin: "https://app.example.com" }],
                kind: "primary",
                status: "live",
                deployed_at: expect.stringMatching(TIMESTAMP),
                metadata: {
                  reason: "deploy",
                  message: "test deploy",
                  rollback_to: null,
                  deployed_by: null,
                  deployed_by_type: "service",
                },
              },
              {
                id: expect.stringMatching(DEPLOYMENT_ID),
                project_id: expect.stringMatching(/^proj-/),
                release_id: deployed.release_id,
                targets: [{ origin: SETUP_ORIGIN.pattern }],
                kind: "primary",
                status: "inactive",
                deployed_at: expect.stringMatching(TIMESTAMP),
                metadata: {
                  reason: "deploy",
                  message: "Initial deployment from setup",
                  rollback_to: null,
                  deployed_by: null,
                  deployed_by_type: "service",
                },
              },
            ],
            count: 2,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("keeps an origin the server put an escape sequence in as it came", async () => {
        const app = await aSetUpApp();
        const origin = platform.servesAHostileOrigin();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 1 deployment",
            items: [
              {
                id: expect.stringMatching(DEPLOYMENT_ID),
                project_id: "proj_1",
                release_id: "rel_1",
                targets: [{ origin }],
                kind: "deploy",
                status: "live",
                deployed_at: "2026-01-01T00:00:00Z",
                metadata: { reason: "deploy" },
              },
            ],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("suggests the next page, repeating the limit", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list", "--limit", "1", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 1 deployment",
            items: [
              {
                id: deployed.deployment_id,
                project_id: expect.stringMatching(/^proj-/),
                release_id: deployed.release_id,
                targets: [{ origin: SETUP_ORIGIN.pattern }, { origin: "https://app.example.com" }],
                kind: "primary",
                status: "live",
                deployed_at: expect.stringMatching(TIMESTAMP),
                metadata: {
                  reason: "deploy",
                  message: "test deploy",
                  rollback_to: null,
                  deployed_by: null,
                  deployed_by_type: "service",
                },
              },
            ],
            count: 1,
            next_page_token: "1",
            next_commands: [
              expectedPublicCliCommand(
                `deployment list --limit 1 --page-token 1 --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps the environment when suggesting the next page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run([
          "deployment",
          "list",
          "--env",
          DEFAULT_ENVIRONMENT,
          "--limit",
          "1",
          "--json",
        ]);

        expect(result).toSuggestExactly(
          `deployment list --limit 1 --page-token 1 --json --env ${DEFAULT_ENVIRONMENT} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
        );
      });

      it("repeats the origin when suggesting the next page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run([
          "deployment",
          "list",
          "--origin",
          SETUP_ORIGIN.pattern,
          "--limit",
          "1",
          "--json",
        ]);

        expect(result).toSuggestExactly(
          `deployment list --origin ${SETUP_ORIGIN.pattern} --limit 1 --page-token 1 --json --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
        );
      });

      it("drains the history with --all, suggesting no next page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list", "--all", "--limit", "1", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Found 2 deployments",
            items: [
              {
                id: deployed.deployment_id,
                project_id: expect.stringMatching(/^proj-/),
                release_id: deployed.release_id,
                targets: [{ origin: SETUP_ORIGIN.pattern }, { origin: "https://app.example.com" }],
                kind: "primary",
                status: "live",
                deployed_at: expect.stringMatching(TIMESTAMP),
                metadata: {
                  reason: "deploy",
                  message: "test deploy",
                  rollback_to: null,
                  deployed_by: null,
                  deployed_by_type: "service",
                },
              },
              {
                id: expect.stringMatching(DEPLOYMENT_ID),
                project_id: expect.stringMatching(/^proj-/),
                release_id: deployed.release_id,
                targets: [{ origin: SETUP_ORIGIN.pattern }],
                kind: "primary",
                status: "inactive",
                deployed_at: expect.stringMatching(TIMESTAMP),
                metadata: {
                  reason: "deploy",
                  message: "Initial deployment from setup",
                  rollback_to: null,
                  deployed_by: null,
                  deployed_by_type: "service",
                },
              },
            ],
            count: 2,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("refuses a --limit that is not a number", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "list", "--limit", "many", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "many is not a valid --limit",
          hint: "Use a whole number from 1 to 100.",
        });
      });

      it("stops on Ctrl-C while the server is not answering", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["deployment", "list", "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:list",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "list", "--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("prints the deployed release, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await asTerminal(() => app.run(["deployment", "list"], colour));

        expect(result).toPrint(deployed.release_id ?? "");
      });

      it.each(RENDERINGS)("names every origin a deployment went to, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await asTerminal(() => app.run(["deployment", "list"], colour));

        expect(result).toPrint("http://localhost:3000, https://app.example.com");
      });

      it.each(RENDERINGS)("spells out an origin the server answered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.servesAHostileOrigin();

        const result = await asTerminal(() => app.run(["deployment", "list"], colour));

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u001b[2J");
        expect(result.stdout).toContain(`${PRIMARY_ORIGIN}\\x1b[2Jwiped`);
      });

      it.each(RENDERINGS)("suggests the next page once, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "list", "--limit", "1"], colour),
        );

        expect(result).toSayOnce("deployment list --limit 1 --page-token 1");
      });

      it("explains a refusal with the message the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "list", "--limit", "many"]);

        expect(result).toSay("many is not a valid --limit");
      });
    });

    describe("--plain", () => {
      it("prints each deployment as a tab-separated record, piped", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await offTerminal(() => app.run(["deployment", "list", "--plain"]));

        expect(result).toPrintPlainRow(
          deployed.deployment_id ?? "",
          deployed.release_id ?? "",
          "primary",
          "deploy",
          "http://localhost:3000, https://app.example.com",
          "",
          /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
        );
      });

      it("prints a preview's kind and the expiry preview list shows, piped", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");
        await app.previewData(PREVIEW_URL);
        const previews = app.envelopeOf<{ items: { expires_at: string }[] }>(
          await app.run(["preview", "list", "--json"]),
        );
        const expires = previews.data.items[0]?.expires_at ?? "";

        const result = await offTerminal(() =>
          app.run(["deployment", "list", "--live", "--plain"]),
        );

        expect(result).toPrintPlainRow(
          /^dep_/,
          /^rel_/,
          "preview",
          "deploy",
          PREVIEW_URL,
          expires,
          /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
        );
      });

      it("prints nothing before anything is deployed, piped", async () => {
        const app = await anUndeployedEnvironment();

        const result = await offTerminal(() =>
          app.run(["deployment", "list", "--env", "staging", "--plain"]),
        );

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });
  });
});
