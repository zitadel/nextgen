import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";
import { PRIMARY_ORIGIN, PREVIEW_PATTERN } from "@tests/helpers/records";

const platform = usePlatformMock();

describe("origin add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.addOrigin(PRIMARY_ORIGIN, "primary");

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/projects\/\S+\/origins$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.addOrigin(PRIMARY_ORIGIN, "primary");

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/projects\/\S+\/origins$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.addOrigin(PRIMARY_ORIGIN, "primary");

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(/^POST \S+\/projects\/\S+\/origins got no response$/),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            reason: "unreachable",
            url: expect.stringMatching(/\/projects\/\S+\/origins$/),
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.addOrigin(PRIMARY_ORIGIN, "primary");
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:add",
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
      const args = ["origin", "add", "https://wiped\u001b[2J.example.com", "--kind", "primary"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses an environment holding only the preview token", async () => {
        const app = await anApp();
        await app.bindEnvironment("ci", {
          ZITADEL_PROJECT_ID: "proj_ci",
          ZITADEL_PREVIEW_TOKEN: "pk_ci",
        });

        const result = await app.run([
          "origin",
          "add",
          PRIMARY_ORIGIN,
          "--kind",
          "primary",
          "--env",
          "ci",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_SECRET is not set for the ci environment",
          hint: "Consulted, in order: --server, process environment, .env.ci.local, .env.ci, .env. Set ZITADEL_PROJECT_SECRET in .env.ci.local or the process environment.",
          details: {
            environment: "ci",
            variable: "ZITADEL_PROJECT_SECRET",
            consulted: ["--server", "process environment", ".env.ci.local", ".env.ci", ".env"],
          },
        });
      });

      it("stores a primary origin on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin(PRIMARY_ORIGIN, "primary");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            title: `Added ${PRIMARY_ORIGIN} (primary)`,
            pattern: PRIMARY_ORIGIN,
            kind: "primary",
            next_commands: [expectedPublicCliCommand(app.againAsRun("origin list"))],
          },
          warnings: [],
        });
        expect(await app.projectOrigins()).toEqual([
          SETUP_ORIGIN,
          { pattern: PRIMARY_ORIGIN, kind: "primary" },
        ]);
      });

      it("stores a preview pattern on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin(PREVIEW_PATTERN, "preview");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            title: `Added ${PREVIEW_PATTERN} (preview)`,
            pattern: PREVIEW_PATTERN,
            kind: "preview",
            next_commands: [expectedPublicCliCommand(app.againAsRun("origin list"))],
          },
          warnings: [],
        });
        expect(await app.projectOrigins()).toEqual([
          SETUP_ORIGIN,
          { pattern: PREVIEW_PATTERN, kind: "preview" },
        ]);
      });

      it("carries a pattern holding a control character raw, and spells it out in the title", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://w\u001b[2J.example.com", "primary");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            title: "Added https://w\\x1b[2J.example.com (primary)",
            pattern: "https://w\u001b[2J.example.com",
            kind: "primary",
            next_commands: [expectedPublicCliCommand(app.againAsRun("origin list"))],
          },
          warnings: [],
        });
      });

      it("answers a dry run with the pattern it would add and the command to run for real", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          PRIMARY_ORIGIN,
          "--kind",
          "primary",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would add origin ${PRIMARY_ORIGIN} (dry run)`,
            verb: "add",
            topic: "origin",
            id: PRIMARY_ORIGIN,
            body: { kind: "primary" },
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`origin add ${PRIMARY_ORIGIN} --kind primary`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("adds nothing on a dry run", async () => {
        const app = await aSetUpApp();

        await app.run([
          "origin",
          "add",
          PRIMARY_ORIGIN,
          "--kind",
          "primary",
          "--dry-run",
          "--json",
        ]);

        expect(await app.projectOrigins()).toEqual([SETUP_ORIGIN]);
      });

      it("quotes a preview pattern in the command a dry run suggests", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          PREVIEW_PATTERN,
          "--kind",
          "preview",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would add origin ${PREVIEW_PATTERN} (dry run)`,
            verb: "add",
            topic: "origin",
            id: PREVIEW_PATTERN,
            body: { kind: "preview" },
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`origin add '${PREVIEW_PATTERN}' --kind preview`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("spells out a control character in a dry run's command and keeps it raw in the data", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          "https://w\u001b[2J.example.com",
          "--kind",
          "primary",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:add",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: "Would add origin https://w\\x1b[2J.example.com (dry run)",
            verb: "add",
            topic: "origin",
            id: "https://w\u001b[2J.example.com",
            body: { kind: "primary" },
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun("origin add $'https://w\\x1b[2J.example.com' --kind primary"),
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("reports the stored pattern, %s", async (_how, colour) => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["origin", "add", PRIMARY_ORIGIN, "--kind", "primary"], colour),
        );

        expect(result).toPrint(`Added ${PRIMARY_ORIGIN} (primary)`);
      });

      it("draws the headline the envelope carries, piped", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "add", PRIMARY_ORIGIN, "--kind", "primary"]);

        expect(result.stdout.split("\n")[0]).toBe(`Added ${PRIMARY_ORIGIN} (primary)`);
      });

      it("draws the dry run's headline, piped", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          PRIMARY_ORIGIN,
          "--kind",
          "primary",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")[0]).toBe(`Would add origin ${PRIMARY_ORIGIN} (dry run)`);
      });

      it("suggests listing the origins once", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "add", PRIMARY_ORIGIN, "--kind", "primary"]);

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("origin list")));
      });

      it("spells out a control character in the pattern given", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          "https://w\u001b[2J.example.com",
          "--kind",
          "primary",
        ]);

        expect(result.stdout.split("\n")[0]).toBe("Added https://w\\x1b[2J.example.com (primary)");
      });

      it.each(RENDERINGS)(
        "writes a pattern the server wrote a bidi override into as a JSON escape, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          platform.storesOrigin(`${PRIMARY_ORIGIN}‮evil`);

          const result = await asTerminal(() =>
            app.run(["origin", "add", PRIMARY_ORIGIN, "--kind", "primary", "--json"], colour),
          );

          expect(result).toSucceed();
          expect(result.stdout).toContain("\\u202e");
          expect(result.stdout).not.toContain("‮");
          expect(app.envelopeOf<{ pattern: string }>(result).data.pattern).toContain("‮");
        },
      );

      it.each(RENDERINGS)(
        "spells out a pattern the server answered with a colour sequence in it, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          platform.storesOrigin(`${PRIMARY_ORIGIN}\u001b[31m`);

          const result = await asTerminal(() =>
            app.run(["origin", "add", PRIMARY_ORIGIN, "--kind", "primary"], colour),
          );

          expect(result).toSucceed();
          expect(result.stdout).toContain("\\x1b[31m");
          expect(result.stdout).not.toContain("\u001b[31m");
        },
      );
    });
  });
});
