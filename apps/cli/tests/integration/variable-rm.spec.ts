import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

describe("variable rm", () => {
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

      const result = await app.removeVariable(name);

      expect(result).toFailWith("E_VALIDATION");
      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:rm",
        source: "",
        code: "E_VALIDATION",
        message,
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is refused for more characters than the limit", async () => {
      const app = await aSetUpApp();

      const result = await app.removeVariable("A".repeat(256));

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:rm",
        source: "",
        code: "E_VALIDATION",
        message: "Variable name is 256 characters; the limit is 255.",
        hint: "Shorten the name.",
      });
    });

    it("is refused on a dry run too, which otherwise reports a removal it could not make", async () => {
      const app = await aSetUpApp();

      const result = await app.removeVariable("GOOGLE-CLIENT", { dryRun: true });

      expect(JSON.parse(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "variable:rm",
        source: "",
        code: "E_VALIDATION",
        message: 'Invalid variable name "GOOGLE-CLIENT".',
        hint: "A variable name contains only letters, digits and underscores.",
      });
    });

    it("is spelled out for a person, where the envelope carries it as typed", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["variable", "rm", "A\u001b[2J", "--force"]);

      expect(result).toSay('Invalid variable name "A\\x1b[2J".');
      expect(result.stdout + result.stderr).not.toContain("\u001b");
    });
  });

  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^DELETE http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+ returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+$/,
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

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+$/,
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

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^DELETE http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+ got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/FOO\?project_id=proj-[0-9a-f]+$/,
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

        const result = app.removeVariable("FOO");
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
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
      await app.setVariable("HOST", "app.acme.com");
      platform.servesAHostileOrigin();
      const args = ["variable", "rm", "HOST", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("removes a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.removeVariable("FOO");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: { name: "FOO", deleted: true, kinds: ["primary", "preview"] },
          warnings: [],
        });
      });

      it("says it removed the preview kind alone under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.removeVariable("FOO", { preview: true });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: { name: "FOO", deleted: true, kinds: ["preview"] },
          warnings: [],
        });
      });

      it("removes a secret without printing its value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.removeVariable("TOKEN");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: { name: "TOKEN", deleted: true, kinds: ["primary", "preview"] },
          warnings: [],
        });
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("leaves the project without that variable", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        expect(await app.removeVariable("FOO")).toSucceed();

        expect(await app.projectVariables()).toEqual([]);
      });

      it("removes the preview override", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");
        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        await app.removeVariable("API_URL", { preview: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("removes a variable for both kinds without --preview", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.removeVariable("API_URL");

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("leaves the primary value when removing the preview value", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");
        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        await app.removeVariable("API_URL", { preview: true });

        expect(await app.projectVariables()).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.removeVariable("NOT_THERE");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "variable not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/variables\/NOT_THERE\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { code: "var.not_found", message: "variable not found" },
          },
        });
      });
    });

    describe("without --force when no one can be asked", () => {
      it("is refused with the question a person is to be asked", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();
        const place = await app.projectPlace();

        const result = await app.run(["variable", "rm", "FOO", "--json"]);

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_CONFIRMATION_REQUIRED",
          message: "Cannot remove FOO from the project without --force in non-interactive mode",
          hint: `Ask a person first: Remove FOO from ${place}? Pass --force only once they agree.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("variable rm FOO --force"))],
          details: { question: `Remove FOO from ${place}?` },
        });
      });

      it("says it is the preview value it would remove, with --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar", { preview: true })).toSucceed();
        const place = await app.projectPlace();

        const result = await app.run(["variable", "rm", "FOO", "--preview", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          code: "E_CONFIRMATION_REQUIRED",
          message:
            "Cannot remove the preview value of FOO from the project without --force in non-interactive mode",
          hint: `Ask a person first: Remove the preview value of FOO from ${place}? Pass --force only once they agree.`,
          next_commands: [
            expectedPublicCliCommand(app.againAsRun("variable rm FOO --force --preview")),
          ],
          details: { question: `Remove the preview value of FOO from ${place}?` },
        });
      });

      it.each(SERVERS)(
        "names the project and the server it would act on, for %s",
        async (_kind, server) => {
          const app = await aSetUpApp();
          expect(await app.setVariable("FOO", "bar")).toSucceed();
          const place = await app.projectPlace(server);

          const result = await app.runWithoutServer([
            "variable",
            "rm",
            "FOO",
            "--server",
            server,
            "--json",
          ]);

          expect(JSON.parse(result.stdout).details).toEqual({
            question: `Remove FOO from ${place}?`,
          });
        },
      );

      it("removes nothing", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.run(["variable", "rm", "FOO", "--json"]);

        expect(await app.projectVariables()).toEqual([
          { name: "FOO", secret: false, value: "bar", preview: { secret: false, value: "bar" } },
        ]);
      });

      it("says the same on a screen as in the envelope", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();
        const place = await app.projectPlace();

        const result = await offTerminal(() => app.run(["variable", "rm", "FOO"]));

        expect(result).toExitWith(3);
        expect(result).toSayOnce("Cannot remove FOO from the project without --force");
        expect(result).toSayOnce(`Remove FOO from ${place}?`);
      });
    });

    describe("a dry run", () => {
      it("says it would remove the variable and changes nothing", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.run(["variable", "rm", "FOO", "--force", "--dry-run", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: "Would remove variable FOO from the project (dry run)",
            verb: "remove",
            topic: "variable",
            id: "FOO",
            kinds: ["primary", "preview"],
            next_commands: [expectedPublicCliCommand(app.againAsRun("variable rm FOO --force"))],
          },
          warnings: [],
        });
      });

      it("leaves the variable on the project", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.run(["variable", "rm", "FOO", "--force", "--dry-run", "--json"]);

        expect(await app.projectVariables()).toEqual([
          { name: "FOO", secret: false, value: "bar", preview: { secret: false, value: "bar" } },
        ]);
      });

      it("says it is the preview value it would remove, keeping --preview in the real command", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "variable",
          "rm",
          "FOO",
          "--force",
          "--preview",
          "--dry-run",
          "--json",
        ]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: "Would remove variable FOO from the project (preview) (dry run)",
            verb: "remove",
            topic: "variable",
            id: "FOO",
            kinds: ["preview"],
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("variable rm FOO --force --preview")),
            ],
          },
          warnings: [],
        });
      });

      it("answers without --force, which a dry run never asks for", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "rm", "FOO", "--dry-run", "--json"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: "Would remove variable FOO from the project (dry run)",
            verb: "remove",
            topic: "variable",
            id: "FOO",
            kinds: ["primary", "preview"],
            next_commands: [expectedPublicCliCommand(app.againAsRun("variable rm FOO"))],
          },
          warnings: [],
        });
      });

      it("draws the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["variable", "rm", "FOO", "--force", "--dry-run"]),
        );

        expect(result).toPrint("Would remove variable FOO from the project (dry run)");
      });
    });

    describe("rendered for a terminal", () => {
      it("draws the headline naming what it removed", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "rm", "FOO", "--force"]));

        expect(result).toPrint("Removed FOO from the project");
      });

      it("names the preview value it removed under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await asTerminal(() =>
          app.run(["variable", "rm", "FOO", "--force", "--preview"]),
        );

        expect(result).toPrint("Removed FOO from the project (preview)");
      });

      it("never prints a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await asTerminal(() => app.run(["variable", "rm", "TOKEN", "--force"]));

        expect(result).toSucceed();
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });
    });
  });
});
