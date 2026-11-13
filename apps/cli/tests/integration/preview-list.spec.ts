import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { PREVIEW_PATTERN, PREVIEW_URL } from "@tests/helpers/records";
import { CREDENTIALS, PREVIEW_CREDENTIAL } from "@/lib/oclif";

const platform = usePlatformMock();

const OTHER_URL = "https://y-acme.vercel.app";

/** Arranges a project with one live preview deployed to {@link PREVIEW_URL}. */
async function anAppWithAPreview() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  await app.previewData(PREVIEW_URL);
  return app;
}

/** Arranges a project with two live previews. */
async function anAppWithTwoPreviews() {
  const app = await anAppWithAPreview();
  await app.previewData(OTHER_URL);
  return app;
}

describe("preview list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:list",
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

        const result = await app.run(["preview", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:list",
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

        const result = app.run(["preview", "list", "--json"]);
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:list",
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
      const args = ["preview", "list"];

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

        const result = await app.run(["preview", "list", "--env", "preview", "--json"]);

        const credential = CREDENTIALS[PREVIEW_CREDENTIAL];
        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:list",
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

      it("is empty on a project with no previews", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "No previews found",
            items: [],
            count: 0,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("shows a preview that was deployed", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 1 preview",
            items: [
              {
                origin: PREVIEW_URL,
                expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
                created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
              },
            ],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("lists every preview with --all across pages, newest first", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--all", "--limit", "1", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 2 previews",
            items: [
              {
                origin: OTHER_URL,
                expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
                created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
              },
              {
                origin: PREVIEW_URL,
                expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
                created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
              },
            ],
            count: 2,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("suggests the next page once, repeating the limit", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--limit", "1", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview:list",
          source: "http://mock.zitadel.test",
          data: {
            title: "Found 1 preview",
            items: [
              {
                origin: OTHER_URL,
                expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
                created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
              },
            ],
            count: 1,
            next_page_token: "1",
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun("preview list --limit 1 --page-token 1 --json"),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("refuses a limit outside the server's bounds", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list", "--limit", "101", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview:list",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "101 is not a valid --limit",
          hint: "Use a whole number from 1 to 100.",
        });
      });

      it("never carries a credential", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "list", "--json"]);

        const values = await app.developmentValues();
        for (const [name, value] of Object.entries(values)) {
          if (/SECRET|TOKEN/.test(name)) {
            expect(result.stdout + result.stderr).not.toContain(value);
          }
        }
      });
    });

    describe("--plain", () => {
      it("prints each preview as a tab-separated record", async () => {
        const app = await anAppWithAPreview();

        const result = await app.run(["preview", "list", "--plain"]);

        expect(result).toPrintPlainRows([PREVIEW_URL, /.+/, /.+/]);
      });

      it("prints nothing on a project with no previews", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list", "--plain"]);

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });

    describe("rendered for a terminal", () => {
      it("prints each preview as a record, newest first, as it does piped", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list"]);

        expect(result).toPrintPlainRows([OTHER_URL, /.+/, /.+/], [PREVIEW_URL, /.+/, /.+/]);
      });

      it("prints nothing on a project with no previews", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "list"]);

        expect(result.stdout).toBe("");
      });

      it("suggests the next page once, off stdout", async () => {
        const app = await anAppWithTwoPreviews();

        const result = await app.run(["preview", "list", "--limit", "1"]);

        expect(result).toSayOnce("preview list --limit 1 --page-token 1");
        expect(result.stdout).not.toContain("--page-token");
      });
    });
  });
});
