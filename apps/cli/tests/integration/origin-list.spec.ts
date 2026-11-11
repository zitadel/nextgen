import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { pressCtrlC } from "@tests/helpers/run-cli";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "@tests/helpers/project";

const platform = usePlatformMock();

describe("origin list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/projects\/\S+$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/projects\/\S+$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(/^GET \S+\/projects\/\S+ got no response$/),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            reason: "unreachable",
            url: expect.stringMatching(/\/projects\/\S+$/),
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(["origin", "list", "--json"]);
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:list",
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
      platform.admitsAHostileOriginPattern();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["origin", "list", "--json"] : ["origin", "list"], how.env),
      );
    });

    describe("--json", () => {
      it("refuses an environment holding only the preview token", async () => {
        const app = await anApp();
        await app.bindEnvironment("ci", {
          ZITADEL_PROJECT_ID: "proj_ci",
          ZITADEL_PREVIEW_TOKEN: "pk_ci",
        });

        const result = await app.run(["origin", "list", "--env", "ci", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "origin:list",
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

      it("lists only the origin setup registered on a fresh project", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          data: { items: [SETUP_ORIGIN], count: 1, next_page_token: null },
          warnings: [],
        });
      });

      it("is empty once every origin is removed", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          data: { items: [], count: 0, next_page_token: null },
          warnings: [],
        });
      });

      it("shows the patterns that were added", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");
        await app.addOrigin("https://*-acme.vercel.app", "preview");

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          data: {
            items: [
              SETUP_ORIGIN,
              { pattern: "https://app.acme.com", kind: "primary" },
              { pattern: "https://*-acme.vercel.app", kind: "preview" },
            ],
            count: 3,
            next_page_token: null,
          },
          warnings: [],
        });
      });

      it("carries a pattern holding a control character raw", async () => {
        const app = await aSetUpApp();
        platform.admitsAHostileOriginPattern();

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "origin:list",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ pattern: "https://admitted.acme.com\u001b[2Jwiped", kind: "primary" }],
            count: 1,
            next_page_token: null,
          },
          warnings: [],
        });
      });
    });

    describe("--plain", () => {
      it("prints each origin as a tab-separated record", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.run(["origin", "list", "--plain"]);

        expect(result).toPrintPlainRows(
          [SETUP_ORIGIN.pattern, SETUP_ORIGIN.kind],
          ["https://app.acme.com", "primary"],
        );
      });

      it("prints nothing when every origin is removed", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();

        const result = await app.run(["origin", "list", "--plain"]);

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });

    describe("rendered for a terminal", () => {
      it("prints each origin as a record, as it does piped", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.run(["origin", "list"]);

        expect(result).toPrintPlainRows(
          [SETUP_ORIGIN.pattern, SETUP_ORIGIN.kind],
          ["https://app.acme.com", "primary"],
        );
      });

      it("spells out a pattern holding a control character", async () => {
        const app = await aSetUpApp();
        platform.admitsAHostileOriginPattern();

        const result = await app.run(["origin", "list"]);

        expect(result).toPrintPlainRows(["https://admitted.acme.com\\x1b[2Jwiped", "primary"]);
      });
    });
  });
});
