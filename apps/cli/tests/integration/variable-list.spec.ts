import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { cliVersion, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("variable list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+ returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope and exit 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["variable", "list", "--json"]);
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["variable", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+ got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            reason: "unreachable",
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["variable", "list", "--json"] : ["variable", "list"], how.env),
      );
    });

    describe("--json", () => {
      it("lists nothing when no variable is entered", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "No variables found",
            items: [],
            count: 0,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("lists every variable with its primary value and what its preview holds", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const result = await app.run(["variable", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 3 variables",
            items: [
              {
                name: "API_URL",
                secret: false,
                preview: { secret: false, value: "https://preview.acme.com" },
              },
              {
                name: "FOO",
                secret: false,
                value: "bar",
                preview: { secret: false, value: "bar" },
              },
              { name: "TOKEN", secret: true },
            ],
            count: 3,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("lists only the names that hold a preview value under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const result = await app.run(["variable", "list", "--preview", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 1 variable",
            items: [{ name: "API_URL", secret: false, value: "https://preview.acme.com" }],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("lists nothing under --preview when no preview value is entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.run(["variable", "list", "--preview", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "No preview variables found",
            items: [],
            count: 0,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("carries a control character in a value as it was stored", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u001b[2Jwiped")).toSucceed();

        const result = await app.run(["variable", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 1 variable",
            items: [
              {
                name: "BANNER",
                secret: false,
                value: "a\u001b[2Jwiped",
                preview: { secret: false, value: "a\u001b[2Jwiped" },
              },
            ],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.run(["variable", "list", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 1 variable",
            items: [{ name: "TOKEN", secret: true }],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("prints a variable that was entered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "list"], colour));

        expect(result).toPrintRow("FOO", "bar");
      });

      it.each(RENDERINGS)("spells out a value the server answered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "list"], colour));

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
      });

      it.each(RENDERINGS)("never prints a secret's value, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "list"], colour));

        expect(result).toPrintRow("TOKEN", "(secret)");
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("says no variable was found when none is entered", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() => app.run(["variable", "list"]));

        expect(result).toPrint("No variables found");
      });
    });

    describe("--plain", () => {
      it("prints each variable as a tab-separated record, piped", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await offTerminal(() => app.run(["variable", "list", "--plain"]));

        expect(result).toPrintPlainRows(["FOO", "bar", "bar"]);
      });

      it("prints a secret as held and a preview-only variable without a primary value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const result = await offTerminal(() => app.run(["variable", "list", "--plain"]));

        expect(result).toPrintPlainRows(
          ["API_URL", "-", "https://preview.acme.com"],
          ["TOKEN", "(secret)", "-"],
        );
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("prints nothing when no variable is entered, piped", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() => app.run(["variable", "list", "--plain"]));

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });
  });
});
