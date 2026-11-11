import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { CREDENTIALS, PREVIEW_CREDENTIAL } from "@/lib/oclif";

const SERVERS = [
  ["a remote server", "http://mock.zitadel.test"],
  ["a local server", "http://localhost:8112"],
];

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

/** Arranges a project with one live preview deployed to {@link PREVIEW_URL}. */
async function anAppWithAPreview() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  await app.previewData(PREVIEW_URL);
  return app;
}

describe("preview rm", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/projects\/\S+\/previews$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/projects\/\S+\/previews$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:rm",
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
      const args = ["preview", "rm", "https://wiped\u001b[2J.preview.example.com", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("fails naming the preview credential when it is not set", async () => {
        const app = await anApp();
        await app.bindEnvironment("preview", {
          ZITADEL_PROJECT_ID: "proj_preview",
          ...(PREVIEW_CREDENTIAL === "project"
            ? { ZITADEL_PREVIEW_TOKEN: "pt" }
            : { ZITADEL_PROJECT_SECRET: "sk" }),
        });

        const result = await app.run([
          "preview",
          "rm",
          PREVIEW_URL,
          "--env",
          "preview",
          "--force",
          "--json",
        ]);

        const credential = CREDENTIALS[PREVIEW_CREDENTIAL];
        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: `${credential} is not set for the preview environment`,
          hint: `Consulted, in order: --server, process environment, .env.preview.local, .env.preview, .env. Set ${credential} in .env.preview.local or the process environment.`,
          details: {
            environment: "preview",
            variable: credential,
            consulted: [
              "--server",
              "process environment",
              ".env.preview.local",
              ".env.preview",
              ".env",
            ],
          },
        });
      });

      it("removes a live preview, so it stops being listed", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Stopped serving ${PREVIEW_URL}`,
            url: PREVIEW_URL,
            deleted: true,
          },
          warnings: [],
        });
        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("removes a preview given with a trailing slash", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", `${PREVIEW_URL}/`, "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          data: {
            title: `Stopped serving ${PREVIEW_URL}`,
            url: PREVIEW_URL,
            deleted: true,
          },
          warnings: [],
        });
        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("answers a dry run without a preview token, with the command to run for real", async () => {
        const app = await anApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would stop serving ${PREVIEW_URL} (dry run)`,
            verb: "stop",
            topic: "preview",
            id: PREVIEW_URL,
            next_commands: [expectedPublicCliCommand(app.againAsRun(`preview rm ${PREVIEW_URL}`))],
          },
          warnings: [],
        });
      });

      it("keeps the --force it was typed with in the command a dry run suggests", async () => {
        const app = await anApp();

        const result = await app.run([
          "preview",
          "rm",
          PREVIEW_URL,
          "--force",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: `Would stop serving ${PREVIEW_URL} (dry run)`,
            verb: "stop",
            topic: "preview",
            id: PREVIEW_URL,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`preview rm ${PREVIEW_URL} --force`)),
            ],
          },
          warnings: [],
        });
      });

      it("carries a URL holding a control character raw in a dry run and spells it out in the title", async () => {
        const app = await anApp();

        const result = await app.run([
          "preview",
          "rm",
          "https://w\u001b[2J.x.com",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          data: {
            dry_run: true,
            title: "Would stop serving https://w\\x1b[2J.x.com (dry run)",
            verb: "stop",
            topic: "preview",
            id: "https://w\u001b[2J.x.com",
            next_commands: [
              expectedPublicCliCommand(app.againAsRun("preview rm $'https://w\\x1b[2J.x.com'")),
            ],
          },
          warnings: [],
        });
      });

      it("stops nothing on a dry run", async () => {
        const app = await anAppWithAPreview();

        await app.run(["preview", "rm", PREVIEW_URL, "--dry-run", "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).not.toEqual([]);
      });

      it("is skipped when the URL is not a live preview, and suggests listing them", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          reason: "not-live",
          data: { title: "Nothing was removed" },
          next_commands: [expectedPublicCliCommand(app.againAsRun("preview list"))],
        });
      });

      it("keeps the environment it was run against in the listing it suggests", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("preview", await app.developmentValues());

        const result = await app.run([
          "preview",
          "rm",
          PREVIEW_URL,
          "--env",
          "preview",
          "--force",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview:rm",
          source: "http://mock.zitadel.test",
          reason: "not-live",
          data: { title: "Nothing was removed" },
          next_commands: [expectedPublicCliCommand(app.againAsRun("preview list --env preview"))],
        });
      });

      describe("without --force when no one can be asked", () => {
        it("is refused, naming what it would stop and how to run it again", async () => {
          const app = await anAppWithAPreview();

          const result = await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: expect.any(String),
            command: "preview:rm",
            source: "http://mock.zitadel.test",
            code: "E_CONFIRMATION_REQUIRED",
            message: `Cannot stop serving ${PREVIEW_URL} without --force in non-interactive mode`,
            hint: `Ask a person first: Stop serving ${PREVIEW_URL} for ${await app.projectPlace()}? Pass --force only once they agree.`,
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`preview rm ${PREVIEW_URL} --force`)),
            ],
            details: {
              question: `Stop serving ${PREVIEW_URL} for ${await app.projectPlace()}?`,
            },
          });
        });

        it.each(SERVERS)(
          "names the project and the server it would act on, for %s",
          async (_kind, server) => {
            const app = await anAppWithAPreview();

            const result = await app.runWithoutServer([
              "preview",
              "rm",
              PREVIEW_URL,
              "--server",
              server,
              "--json",
            ]);

            expect(app.envelopeOf(result)).toEqual({
              status: "error",
              cli_version: expect.any(String),
              command: "preview:rm",
              source: server,
              code: "E_CONFIRMATION_REQUIRED",
              message: `Cannot stop serving ${PREVIEW_URL} without --force in non-interactive mode`,
              hint: `Ask a person first: Stop serving ${PREVIEW_URL} for ${await app.projectPlace(server)}? Pass --force only once they agree.`,
              next_commands: [
                expectedPublicCliCommand(
                  `preview rm ${PREVIEW_URL} --force --server ${server} --cwd ${app.path}`,
                ),
              ],
              details: {
                question: `Stop serving ${PREVIEW_URL} for ${await app.projectPlace(server)}?`,
              },
            });
          },
        );

        it("removes nothing", async () => {
          const app = await anAppWithAPreview();

          await app.run(["preview", "rm", PREVIEW_URL, "--json"]);

          const listed = await app.run(["preview", "list", "--json"]);
          expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).not.toEqual([]);
        });
      });

      it("never carries a credential", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force", "--json"]);

        const values = await app.developmentValues();
        for (const [name, value] of Object.entries(values)) {
          if (/SECRET|TOKEN/.test(name)) {
            expect(result.stdout + result.stderr).not.toContain(value);
          }
        }
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it stopped serving, as the envelope's title does", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result.stdout).toBe(`Stopped serving ${PREVIEW_URL}\n`);
      });

      it("draws the dry run's headline, and suggests the real command once", async () => {
        const app = await anApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--dry-run"]);

        expect(result.stdout.split("\n")[0]).toBe(`Would stop serving ${PREVIEW_URL} (dry run)`);
        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun(`preview rm ${PREVIEW_URL}`)),
        );
      });

      it("says nothing was removed when the URL is not a live preview", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result.stdout.split("\n").slice(0, 3)).toEqual([
          "Nothing was removed",
          "",
          `${PREVIEW_URL} is not a live preview of the project`,
        ]);
      });

      it("suggests listing the live previews once", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", PREVIEW_URL, "--force"]);

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("preview list")));
      });

      it("spells out a control character in the URL that is not a live preview", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "rm", "https://w\u001b[2J.x.com", "--force"]);

        expect(result.stdout.split("\n")[2]).toBe(
          "https://w\\x1b[2J.x.com is not a live preview of the project",
        );
        expect(result.stdout + result.stderr).not.toContain("\u001b");
      });
    });
  });
});
