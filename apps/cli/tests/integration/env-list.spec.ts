import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, asTerminal, MOCK_SERVER_URL } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("env list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, as it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 1 environment",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: true,
              },
            ],
            count: 1,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds, as it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 1 environment",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: true,
              },
            ],
            count: 1,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["env", "list"];

      await app.inEveryRendering((how) =>
        app.runWithoutServer(how.json ? [...args, "--json"] : args, how.env),
      );
    });

    describe("--json", () => {
      it("lists the environments bound in this directory", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 2 environments",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: true,
              },
              {
                name: "production",
                source: ".env.production.local",
                server: MOCK_SERVER_URL,
                project_id: "proj_prod",
                resolved: false,
              },
            ],
            count: 2,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
          },
          warnings: [],
        });
      });

      it("leaves out a file that binds no project", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();
        await app.bindEnvironment("scratch", { ZITADEL_URL: MOCK_SERVER_URL });

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 1 environment",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: true,
              },
            ],
            count: 1,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
          },
          warnings: [],
        });
      });

      it("marks the environment that resolves now", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["env", "list", "--env", "production", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 2 environments",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: false,
              },
              {
                name: "production",
                source: ".env.production.local",
                server: MOCK_SERVER_URL,
                project_id: "proj_prod",
                resolved: true,
              },
            ],
            count: 2,
            next_page_token: null,
            resolved: { name: "production", source: "--env" },
          },
          warnings: [],
        });
      });

      it("includes the process environment when it carries a project", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.run(["env", "list", "--json"], { ZITADEL_PROJECT_ID: "proj_ci" });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "Found 2 environments",
            items: [
              {
                name: "development",
                source: ".env.development.local",
                server: MOCK_SERVER_URL,
                project_id: ZITADEL_PROJECT_ID,
                resolved: false,
              },
              {
                name: "development",
                source: "process environment",
                server: "",
                project_id: "proj_ci",
                resolved: true,
              },
            ],
            count: 2,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
          },
          warnings: [],
        });
      });

      it("lists nothing, and suggests adding an environment, when none is bound", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:list",
          source: MOCK_SERVER_URL,
          data: {
            title: "No environments found",
            items: [],
            count: 0,
            next_page_token: null,
            resolved: { name: "development", source: "default" },
            next_commands: [expectedPublicCliCommand(`env add '<name>' --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("carries a control character in a project id as it was read", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj\u001b[2Jwiped",
        });

        const result = await app.run(["env", "list", "--json"]);

        expect(JSON.parse(result.stdout).data.items).toEqual([
          {
            name: "production",
            source: ".env.production.local",
            server: MOCK_SERVER_URL,
            project_id: "proj\u001b[2Jwiped",
            resolved: false,
          },
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("says which environment resolves now", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.run(["env", "list"]));

        expect(result).toPrint("Resolved now: development (from default)");
      });

      it("resolves nothing to report when nothing is bound", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await asTerminal(() => app.run(["env", "list"]));

        expect(result).not.toPrint("Resolved now");
      });

      it("says no environment was found when none is bound", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await asTerminal(() => app.run(["env", "list"]));

        expect(result).toPrint("No environments found");
      });

      it("points an empty list at env add, with the directory it ran in", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await asTerminal(() => app.run(["env", "list"]));

        expect(result).toSay(expectedPublicCliCommand(`env add '<name>' --cwd ${app.path}`));
      });

      it("spells out a control character in a project id it read", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj\u001b[2Jwiped",
        });

        const result = await asTerminal(() => app.run(["env", "list"]));

        expect(result.stdout).toContain("proj\\x1b[2Jwiped");
        expect(result.stdout).not.toContain("\u001b[2J");
      });
    });

    describe("--plain", () => {
      it("prints each environment as a tab-separated record", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.run(["env", "list", "--plain"]);

        expect(result).toPrintPlainRows([
          "development",
          ".env.development.local",
          MOCK_SERVER_URL,
          `${ZITADEL_PROJECT_ID}`,
          "yes",
        ]);
      });

      it("leaves the resolved column empty for an environment that does not resolve", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();
        await app.bindEnvironment("production", {
          ZITADEL_URL: MOCK_SERVER_URL,
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["env", "list", "--plain"]);

        expect(result).toPrintPlainRows(
          [
            "development",
            ".env.development.local",
            MOCK_SERVER_URL,
            `${ZITADEL_PROJECT_ID}`,
            "yes",
          ],
          ["production", ".env.production.local", MOCK_SERVER_URL, "proj_prod", ""],
        );
      });

      it("prints nothing on stdout, and the next step once on stderr, when none is bound", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile(".env.development.local");

        const result = await offTerminal(() => app.run(["env", "list", "--plain"]));

        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
          expectedPublicCliCommand(`env add '<name>' --cwd ${app.path}`),
        );
        expect(result).toSayOnce(expectedPublicCliCommand(`env add '<name>' --cwd ${app.path}`));
      });
    });
  });
});
