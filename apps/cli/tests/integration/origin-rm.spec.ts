import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

describe("origin rm", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/projects\/\S+\/origins\/remove$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/projects\/\S+\/origins\/remove$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^POST \S+\/projects\/\S+\/origins\/remove got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            reason: "unreachable",
            url: expect.stringMatching(/\/projects\/\S+\/origins\/remove$/),
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.removeOrigin(PRIMARY_ORIGIN);
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:rm",
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
      await app.addPrimaryOrigin();
      platform.servesAHostileOrigin();
      const args = ["origin", "rm", "https://app.example.com", "--force"];

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
          "rm",
          PRIMARY_ORIGIN,
          "--force",
          "--env",
          "ci",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:rm",
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

      it("stops admitting a pattern that was added", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Removed ${PRIMARY_ORIGIN} from the project's origins`,
            pattern: PRIMARY_ORIGIN,
            deleted: true,
          },
          warnings: [],
        });
        expect(await app.projectOrigins()).toEqual([SETUP_ORIGIN]);
      });

      it("succeeds on a pattern the project does not hold, as the server answers 204", async () => {
        const app = await aSetUpApp();

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Removed ${PRIMARY_ORIGIN} from the project's origins`,
            pattern: PRIMARY_ORIGIN,
            deleted: true,
          },
          warnings: [],
        });
      });

      it("carries a pattern holding a control character raw, and spells it out in the title", async () => {
        const app = await aSetUpApp();

        const result = await app.removeOrigin("https://w\u001b[2J.example.com");

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: "Removed https://w\\x1b[2J.example.com from the project's origins",
            pattern: "https://w\u001b[2J.example.com",
            deleted: true,
          },
          warnings: [],
        });
      });

      it("warns once that removing the last origin admits no origin except loopback", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Removed ${PRIMARY_ORIGIN}`,
            pattern: PRIMARY_ORIGIN,
            deleted: true,
          },
          warnings: [
            `${PRIMARY_ORIGIN} was the project's last origin, so the project now admits no origin except a loopback origin. Add the ones it should admit with ${expectedPublicCliCommand(app.againAsRun("origin add '<your-app-url>' --kind primary"))}.`,
          ],
        });
      });

      it("does not warn while other origins remain", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");
        await app.addOrigin("https://www.acme.com", "primary");

        const result = await app.removeOrigin(PRIMARY_ORIGIN);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Removed ${PRIMARY_ORIGIN} from the project's origins`,
            pattern: PRIMARY_ORIGIN,
            deleted: true,
          },
          warnings: [],
        });
      });

      it("answers a dry run with the pattern it would remove and the command to run for real", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would remove origin ${PRIMARY_ORIGIN} from the project (dry run)`,
            verb: "remove",
            topic: "origin",
            id: PRIMARY_ORIGIN,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`origin rm ${PRIMARY_ORIGIN}`)),
            ],
          },
          warnings: [],
        });
      });

      it("keeps the --force it was typed with in the command a dry run suggests", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "rm",
          PRIMARY_ORIGIN,
          "--force",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would remove origin ${PRIMARY_ORIGIN} from the project (dry run)`,
            verb: "remove",
            topic: "origin",
            id: PRIMARY_ORIGIN,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`origin rm ${PRIMARY_ORIGIN} --force`)),
            ],
          },
          warnings: [],
        });
      });

      it("removes nothing on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        await app.run(["origin", "rm", PRIMARY_ORIGIN, "--dry-run", "--json"]);

        expect(await app.projectOrigins()).toEqual([
          SETUP_ORIGIN,
          { pattern: PRIMARY_ORIGIN, kind: "primary" },
        ]);
      });

      describe("without --force when no one can be asked", () => {
        it("is refused, naming what it would remove and how to run it again", async () => {
          const app = await aSetUpApp();
          await app.addOrigin(PRIMARY_ORIGIN, "primary");

          const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: expect.any(String),
            command: "origin:rm",
            source: "http://mock.zitadel.test",
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot remove ${PRIMARY_ORIGIN} from the project without --force in non-interactive mode`,
            hint: `Ask a person first: Remove ${PRIMARY_ORIGIN} from ${await app.projectPlace()}? Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`origin rm ${PRIMARY_ORIGIN} --force`)),
            ],
            details: {
              question: `Remove ${PRIMARY_ORIGIN} from ${await app.projectPlace()}?`,
            },
          });
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await aSetUpApp();
            await app.addOrigin(PRIMARY_ORIGIN, "primary");

            const result = await app.runWithoutServer([
              "origin",
              "rm",
              PRIMARY_ORIGIN,
              "--server",
              server,
              "--json",
            ]);

            expect(app.envelopeOf(result)).toEqual({
              status: "error",
              cli_version: expect.any(String),
              command: "origin:rm",
              source: server,
              code: "E_CONFIRMATION_REQUIRED",
              message: `Cannot remove ${PRIMARY_ORIGIN} from the project without --force in non-interactive mode`,
              hint: `Ask a person first: Remove ${PRIMARY_ORIGIN} from ${await app.projectPlace(server)}? Pass --force only once they agree.`,
              next_commands: [
                expectedPublicCliCommand(
                  `origin rm ${PRIMARY_ORIGIN} --force --server ${server} --cwd ${app.path}`,
                ),
              ],
              details: {
                question: `Remove ${PRIMARY_ORIGIN} from ${await app.projectPlace(server)}?`,
              },
            });
          },
        );

        it("carries a control character raw in the question and spells it out in the suggestion", async () => {
          const app = await aSetUpApp();

          const result = await app.run([
            "origin",
            "rm",
            "https://w\u001b[2J.example.com",
            "--json",
          ]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: expect.any(String),
            command: "origin:rm",
            source: "http://mock.zitadel.test",
            code: "E_CONFIRMATION_REQUIRED",
            message:
              "Cannot remove https://w\u001b[2J.example.com from the project without --force in non-interactive mode",
            hint: `Ask a person first: Remove https://w\u001b[2J.example.com from ${await app.projectPlace()}? Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun("origin rm $'https://w\\x1b[2J.example.com' --force"),
              ),
            ],
            details: {
              question: `Remove https://w\u001b[2J.example.com from ${await app.projectPlace()}?`,
            },
          });
        });

        it("removes nothing", async () => {
          const app = await aSetUpApp();
          await app.addOrigin(PRIMARY_ORIGIN, "primary");

          await app.run(["origin", "rm", PRIMARY_ORIGIN, "--json"]);

          expect(await app.projectOrigins()).toEqual([
            SETUP_ORIGIN,
            { pattern: PRIMARY_ORIGIN, kind: "primary" },
          ]);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what stops being admitted, as the envelope's title does", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--force"]);

        expect(result.stdout.split("\n")[0]).toBe(
          `Removed ${PRIMARY_ORIGIN} from the project's origins`,
        );
      });

      it("draws the dry run's headline", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--dry-run"]);

        expect(result.stdout.split("\n")[0]).toBe(
          `Would remove origin ${PRIMARY_ORIGIN} from the project (dry run)`,
        );
      });

      it("spells out a control character in the pattern given", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "rm", "https://w\u001b[2J.example.com", "--force"]);

        expect(result.stdout.split("\n")[0]).toBe(
          "Removed https://w\\x1b[2J.example.com from the project's origins",
        );
      });

      it("spells out a control character in the question it refuses with", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "rm", "https://w\u001b[2J.example.com"]);

        expect(result).toSay("Remove https://w\\x1b[2J.example.com from");
        expect(result.stderr).not.toContain("\u001b");
      });

      it("warns once that removing the last origin admits no origin except loopback", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--force"]);

        expect(result).toSayOnce("admits no origin except a loopback origin. Add");
      });

      it("says how to add an origin back after removing the last one, once", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();
        await app.addOrigin(PRIMARY_ORIGIN, "primary");

        const result = await app.run(["origin", "rm", PRIMARY_ORIGIN, "--force"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun("origin add '<your-app-url>' --kind primary")),
        );
      });
    });
  });
});
