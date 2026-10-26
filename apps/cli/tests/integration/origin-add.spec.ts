import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "../helpers/project";

const platform = usePlatformMock();

describe("origin add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.addOrigin("https://app.acme.com", "primary");

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

        const result = await app.run([
          "origin",
          "add",
          "https://app.acme.com",
          "--kind",
          "primary",
          "--env",
          "ci",
          "--json",
        ]);

        expect(result).toSay("ZITADEL_PROJECT_SECRET");
      });

      it("stores a primary origin on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toSucceed();
        expect(await app.projectOrigins()).toEqual([
          SETUP_ORIGIN,
          { pattern: "https://app.acme.com", kind: "primary" },
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("reports the stored pattern", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "origin",
          "add",
          "https://app.acme.com",
          "--kind",
          "primary",
        ]);

        expect(result).toPrint("https://app.acme.com");
      });
    });
  });
});
