import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { cliVersion, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, onTerminalReadingAFile } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("variable get", () => {
  describe("a name the platform cannot accept", () => {
    // Every command that names a variable refuses the name itself, so neither a
    // dry run nor a confirmation can report work the platform would never do.
    it.each([
      ["GOOGLE-CLIENT", 'Invalid variable name "GOOGLE-CLIENT".'],
      ["a.b", 'Invalid variable name "a.b".'],
      ["has space", 'Invalid variable name "has space".'],
      ["A\u001b[2J", 'Invalid variable name "A\u001b[2J".'],
    ])("is refused for %j", async (name, message) => {
      const app = await aSetUpApp();

      const result = await app.getVariable(name);

      expect(result).toFailWith("E_VALIDATION");
      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:get",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message,
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is refused for more characters than the limit", async () => {
      const app = await aSetUpApp();

      const result = await app.getVariable("A".repeat(256));

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:get",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message: "Variable name is 256 characters; the limit is 255.",
        hint: "Shorten the name.",
      });
    });

    it("is refused on a dry run too, which otherwise reports work it could not do", async () => {
      const app = await aSetUpApp();

      const result = await app.getVariable("GOOGLE-CLIENT", { dryRun: true });

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:get",
        source: "http://mock.zitadel.test",
        code: "E_VALIDATION",
        message: 'Invalid variable name "GOOGLE-CLIENT".',
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is spelled out for a person, where the envelope carries it as typed", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["variable", "get", "A\u001b[2J"]);

      expect(result).toSay('Invalid variable name "A\\x1b[2J".');
      expect(result.stdout + result.stderr).not.toContain("\u001b");
    });
  });

  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.getVariable("FOO");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+&kind=primary returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+&kind=primary$/,
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

        const result = await app.getVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+&kind=primary$/,
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.getVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+&kind=primary got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+&kind=primary$/,
            ),
            reason: "unreachable",
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope and exit 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.getVariable("FOO");
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");
      const args = ["variable", "get", "BANNER"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reads back a value that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.getVariable("FOO");

        expect(result).toSucceed();
        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          data: {
            title: "Read FOO",
            name: "FOO",
            secret: false,
            value: "bar",
          },
          warnings: [],
        });
      });

      it("reads the preview override under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("API_URL", "https://api.acme.com")).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const result = await app.getVariable("API_URL", { preview: true });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          data: {
            title: "Read API_URL",
            name: "API_URL",
            secret: false,
            value: "https://preview.acme.com",
          },
          warnings: [],
        });
      });

      it("carries a control character in a value as it was stored", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u001b[2Jwiped")).toSucceed();

        const result = await app.getVariable("BANNER");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          data: {
            title: "Read BANNER",
            name: "BANNER",
            secret: false,
            value: "a\u001b[2Jwiped",
          },
          warnings: [],
        });
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.getVariable("NOT_THERE");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "variable not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/NOT_THERE\?project_id=proj-[0-9a-f]+&kind=primary$/,
            ),
            body: { code: "var.not_found", message: "variable not found" },
          },
        });
      });

      it("refuses a preview value the project does not hold", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.getVariable("TOKEN", { preview: true });

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "variable not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/TOKEN\?project_id=proj-[0-9a-f]+&kind=preview$/,
            ),
            body: { code: "var.not_found", message: "variable not found" },
          },
        });
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.getVariable("TOKEN");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:get",
          source: "http://mock.zitadel.test",
          data: {
            title: "Read TOKEN",
            name: "TOKEN",
            secret: true,
          },
          warnings: [],
        });
      });
    });

    describe("piped", () => {
      it("gives a pipe a body that parses back to the value that was stored", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await offTerminal(() => app.getVariable("BANNER", { json: false }));

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
        expect(JSON.parse(result.stdout)).toEqual({
          name: "BANNER",
          secret: false,
          value: "a\u009bb",
        });
      });

      it("names the variable and says it is a secret, never its value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await offTerminal(() => app.getVariable("TOKEN", { json: false }));

        expect(JSON.parse(result.stdout)).toEqual({ name: "TOKEN", secret: true });
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("prints nothing on stderr when it succeeds", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await offTerminal(() => app.getVariable("FOO", { json: false }));

        expect(result.stderr).toBe("");
      });
    });

    describe("rendered for a terminal", () => {
      it("spells out a value for a person, where a pipe gets it as it was stored", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "hello\u001b[2Jwiped")).toSucceed();

        const result = await onTerminalReadingAFile(() => {
          return app.getVariable("BANNER", { json: false });
        });

        expect(result).toSucceed();
        expect(result.stdout).toContain("hello\\x1b[2Jwiped");
        expect(result.stdout).not.toContain("\u001b");
      });

      it("draws the headline naming the variable it read", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() => app.getVariable("FOO", { json: false }));

        expect(result).toPrint("Read FOO");
      });

      it("prints the value it read", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() => app.getVariable("FOO", { json: false }));

        expect(result).toPrintRow("value", "bar");
      });

      it("never prints a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await asTerminal(() => app.getVariable("TOKEN", { json: false }));

        expect(result).toSucceed();
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });
    });
  });
});
