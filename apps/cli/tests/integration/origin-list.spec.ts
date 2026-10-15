import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "../helpers/project";

const platform = usePlatformMock();

describe("origin list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses an environment holding only the preview token", async () => {
        const app = await anApp();
        await app.bindEnvironment("ci", {
          ZITADEL_PROJECT_ID: "proj_ci",
          ZITADEL_PREVIEW_TOKEN: "pk_ci",
        });

        const result = await app.run(["origin", "list", "--env", "ci", "--json"]);

        expect(result).toSay("ZITADEL_PROJECT_SECRET");
      });

      it("lists only the origin setup registered on a fresh project", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf<{ items: unknown[] }>(result).data.items).toEqual([SETUP_ORIGIN]);
      });

      it("is empty once every origin is removed", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();

        const result = await app.run(["origin", "list", "--json"]);

        expect(app.envelopeOf<{ items: unknown[] }>(result).data.items).toEqual([]);
      });

      it("shows the patterns that were added", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");
        await app.addOrigin("https://*-acme.vercel.app", "preview");

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ items: { pattern: string }[] }>(result).data.items).toEqual([
          SETUP_ORIGIN,
          { pattern: "https://app.acme.com", kind: "primary" },
          { pattern: "https://*-acme.vercel.app", kind: "preview" },
        ]);
      });
    });
  });
});
