import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

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
      it("stores a primary origin on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toSucceed();
        expect(await app.projectOrigins()).toEqual([
          { pattern: "https://app.acme.com", kind: "primary" },
        ]);
      });

      it("refuses a wildcard primary", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://*.acme.com", "primary");

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.projectOrigins()).toEqual([]);
      });

      it("refuses an unbounded preview wildcard on a shared host", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://*.vercel.app", "preview");

        expect(result).toFailWith("E_VALIDATION");
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
