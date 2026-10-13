import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

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
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("is empty on a fresh project", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ items: unknown[] }>(result).data.items).toEqual([]);
      });

      it("shows the patterns that were added", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");
        await app.addOrigin("https://*-acme.vercel.app", "preview");

        const result = await app.run(["origin", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ items: { pattern: string }[] }>(result).data.items).toEqual([
          { pattern: "https://app.acme.com", kind: "primary" },
          { pattern: "https://*-acme.vercel.app", kind: "preview" },
        ]);
      });
    });
  });
});
