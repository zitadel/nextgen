import { describe, expect, it } from "vitest";

import { asTerminal, offTerminal, RENDERINGS } from "@tests/helpers/terminal";
import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { cliVersion } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

describe("env", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, as it never asks the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.run(["env", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "http://mock.zitadel.test",
          data: {
            environment: { name: "development", source: "default" },
            values: [
              { variable: "ZITADEL_URL", value: "http://mock.zitadel.test", source: "--server" },
              {
                variable: "ZITADEL_PROJECT_ID",
                value: ZITADEL_PROJECT_ID,
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PROJECT_SECRET",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PREVIEW_TOKEN",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_ISSUER",
                value: "http://localhost:3000",
                source: ".env.development.local",
              },
            ],
            consulted: [
              { source: "--server", present: true, supplied: ["ZITADEL_URL"] },
              { source: "process environment", present: true, supplied: [] },
              {
                source: ".env.development.local",
                present: true,
                supplied: [
                  "ZITADEL_PROJECT_ID",
                  "ZITADEL_PROJECT_SECRET",
                  "ZITADEL_PREVIEW_TOKEN",
                  "ZITADEL_ISSUER",
                ],
              },
              { source: ".env.local", present: true, supplied: [] },
              { source: ".env.development", present: false, supplied: [] },
              { source: ".env", present: false, supplied: [] },
              { source: ".zitadel/secret", present: true, supplied: [] },
            ],
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

        const result = await app.run(["env", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "http://mock.zitadel.test",
          data: {
            environment: { name: "development", source: "default" },
            values: [
              { variable: "ZITADEL_URL", value: "http://mock.zitadel.test", source: "--server" },
              {
                variable: "ZITADEL_PROJECT_ID",
                value: ZITADEL_PROJECT_ID,
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PROJECT_SECRET",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PREVIEW_TOKEN",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_ISSUER",
                value: "http://localhost:3000",
                source: ".env.development.local",
              },
            ],
            consulted: [
              { source: "--server", present: true, supplied: ["ZITADEL_URL"] },
              { source: "process environment", present: true, supplied: [] },
              {
                source: ".env.development.local",
                present: true,
                supplied: [
                  "ZITADEL_PROJECT_ID",
                  "ZITADEL_PROJECT_SECRET",
                  "ZITADEL_PREVIEW_TOKEN",
                  "ZITADEL_ISSUER",
                ],
              },
              { source: ".env.local", present: true, supplied: [] },
              { source: ".env.development", present: false, supplied: [] },
              { source: ".env", present: false, supplied: [] },
              { source: ".zitadel/secret", present: true, supplied: [] },
            ],
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
      const args = ["env"];

      await app.inEveryRendering((how) =>
        app.runWithoutServer(how.json ? [...args, "--json"] : args, how.env),
      );
    });

    describe("--json", () => {
      it("names the file a set-up project resolves from", async () => {
        const app = await aSetUpApp();
        const { ZITADEL_PROJECT_ID } = await app.developmentValues();

        const result = await app.runWithoutServer(["env", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "http://mock.zitadel.test",
          data: {
            environment: { name: "development", source: "default" },
            values: [
              {
                variable: "ZITADEL_URL",
                value: "http://mock.zitadel.test",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PROJECT_ID",
                value: ZITADEL_PROJECT_ID,
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PROJECT_SECRET",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_PREVIEW_TOKEN",
                value: "••••••••",
                source: ".env.development.local",
              },
              {
                variable: "ZITADEL_ISSUER",
                value: "http://localhost:3000",
                source: ".env.development.local",
              },
            ],
            consulted: [
              { source: "--server", present: false, supplied: [] },
              { source: "process environment", present: true, supplied: [] },
              {
                source: ".env.development.local",
                present: true,
                supplied: [
                  "ZITADEL_URL",
                  "ZITADEL_PROJECT_ID",
                  "ZITADEL_PROJECT_SECRET",
                  "ZITADEL_PREVIEW_TOKEN",
                  "ZITADEL_ISSUER",
                ],
              },
              { source: ".env.local", present: true, supplied: [] },
              { source: ".env.development", present: false, supplied: [] },
              { source: ".env", present: false, supplied: [] },
              { source: ".zitadel/secret", present: true, supplied: [] },
            ],
          },
          warnings: [],
        });
      });

      it("resolves the environment --env names", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.runWithoutServer(["env", "--env", "production", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "https://prod.example",
          data: {
            environment: { name: "production", source: "--env" },
            values: [
              {
                variable: "ZITADEL_URL",
                value: "https://prod.example",
                source: ".env.production.local",
              },
              {
                variable: "ZITADEL_PROJECT_ID",
                value: "proj_prod",
                source: ".env.production.local",
              },
            ],
            consulted: [
              { source: "--server", present: false, supplied: [] },
              { source: "process environment", present: true, supplied: [] },
              {
                source: ".env.production.local",
                present: true,
                supplied: ["ZITADEL_URL", "ZITADEL_PROJECT_ID"],
              },
              { source: ".env.production", present: false, supplied: [] },
              { source: ".env", present: false, supplied: [] },
            ],
          },
          warnings: [],
        });
      });

      it("resolves the values of the file --env-file names", async () => {
        const app = await aSetUpApp();
        const file = await app.writeEnvFile("staging.env", {
          ZITADEL_URL: "https://staging.example",
          ZITADEL_PROJECT_ID: "proj_staging",
        });

        const result = await app.runWithoutServer(["env", "--env-file", file, "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "https://staging.example",
          data: {
            environment: { name: "development", source: "default" },
            values: [
              {
                variable: "ZITADEL_URL",
                value: "https://staging.example",
                source: `--env-file ${file}`,
              },
              {
                variable: "ZITADEL_PROJECT_ID",
                value: "proj_staging",
                source: `--env-file ${file}`,
              },
            ],
            consulted: [
              { source: "--server", present: false, supplied: [] },
              {
                source: `--env-file ${file}`,
                present: true,
                supplied: ["ZITADEL_URL", "ZITADEL_PROJECT_ID"],
              },
              { source: "process environment", present: true, supplied: [] },
            ],
          },
          warnings: [],
        });
      });

      it("says what an environment nothing is bound to resolves", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["env", "--env", "nothere", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env",
          source: "",
          data: {
            environment: { name: "nothere", source: "--env" },
            values: [],
            consulted: [
              { source: "--server", present: false, supplied: [] },
              { source: "process environment", present: true, supplied: [] },
              { source: ".env.nothere.local", present: false, supplied: [] },
              { source: ".env.nothere", present: false, supplied: [] },
              { source: ".env", present: false, supplied: [] },
            ],
          },
          warnings: [],
        });
      });

      it("refuses --env together with --env-file", async () => {
        const app = await aSetUpApp();
        const file = await app.writeEnvFile("staging.env", { ZITADEL_PROJECT_ID: "proj_staging" });

        const result = await app.run(["env", "--env", "production", "--env-file", file, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env",
          source: "",
          code: "E_VALIDATION",
          message: "--env and --env-file cannot be used together",
          hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
        });
      });

      it("carries a control character in a value as it was read", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj\u001b[2Jwiped",
        });

        const result = await app.runWithoutServer(["env", "--env", "production", "--json"]);

        expect(JSON.parse(result.stdout).data.values).toEqual([
          {
            variable: "ZITADEL_URL",
            value: "https://prod.example",
            source: ".env.production.local",
          },
          {
            variable: "ZITADEL_PROJECT_ID",
            value: "proj\u001b[2Jwiped",
            source: ".env.production.local",
          },
        ]);
      });

      it("withholds the rest of a secret", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_0123456789abcdef",
          ZITADEL_PREVIEW_TOKEN: "pk_0123456789abcdef",
        });

        const result = await app.run(["env", "--env", "production", "--json"]);

        expect(JSON.parse(result.stdout).data.values).toEqual([
          { variable: "ZITADEL_URL", value: "http://mock.zitadel.test", source: "--server" },
          { variable: "ZITADEL_PROJECT_ID", value: "proj_prod", source: ".env.production.local" },
          {
            variable: "ZITADEL_PROJECT_SECRET",
            value: "••••••••",
            source: ".env.production.local",
          },
          { variable: "ZITADEL_PREVIEW_TOKEN", value: "••••••••", source: ".env.production.local" },
        ]);
        expect(result.stdout + result.stderr).not.toContain("0123456789abcdef");
      });

      it("never shows a short secret whole", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_short",
        });

        const result = await app.run(["env", "--env", "production", "--json"]);

        expect(result.stdout + result.stderr).not.toContain("sk_short");
      });
    });

    describe("piped", () => {
      it("never shows a secret", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_0123456789abcdef",
        });

        const result = await offTerminal(() => app.run(["env", "--env", "production"]));

        expect(result).toPrint("••••••••");
        expect(result.stdout + result.stderr).not.toContain("sk_0123456789abcdef");
      });

      it("names the environment and where it came from, once", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() => app.runWithoutServer(["env"]));

        expect(result).toSayOnce("Using the development environment (from default)");
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("names the environment, %s", async (_how, colour) => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.runWithoutServer(["env"], colour));

        expect(result).toPrint("Using the development environment (from default)");
      });

      it.each(RENDERINGS)("lists the files it looked in, %s", async (_how, colour) => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.runWithoutServer(["env"], colour));

        expect(result).toPrint("Consulted, in order:");
      });

      it.each(RENDERINGS)("renders text rather than a json envelope, %s", async (_how, colour) => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.runWithoutServer(["env"], colour));

        expect(result).toPrintNoJson();
      });

      it.each(RENDERINGS)("never shows a secret, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_PROJECT_ID: "proj_prod",
          ZITADEL_PROJECT_SECRET: "sk_0123456789abcdef",
        });

        const result = await asTerminal(() => app.run(["env", "--env", "production"], colour));

        expect(result).toPrintRow("ZITADEL_PROJECT_SECRET", "••••••••");
        expect(result.stdout + result.stderr).not.toContain("sk_0123456789abcdef");
      });

      it("spells out a control character in a value it read", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj\u001b[2Jwiped",
        });

        const result = await offTerminal(() =>
          app.runWithoutServer(["env", "--env", "production"]),
        );

        expect(result.stdout).toContain("proj\\x1b[2Jwiped");
        expect(result.stdout).not.toContain("\u001b");
      });
    });
  });
});
