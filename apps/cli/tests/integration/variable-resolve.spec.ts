import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variable resolve", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("is a miss when nothing is deployed", async () => {
        const app = await aSetUpApp();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("says the server cannot hand back a deployment's variables yet", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
      });

      it("is a miss for an origin with nothing deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://not-deployed.acme.com" });

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("suggests listing the origins for a URL that is none of them", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://typo.acme.com" });

        expect(result).toSuggest("origin list");
      });

      it("suggests deploying to a primary origin added since the last deploy", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.resolveVariables({ origin: "https://c.example.com" });

        expect(result).toSuggest("deploy");
      });

      it("suggests no deploy for a preview origin, which only a preview build serves", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://pr-7-acme.vercel.app" });

        expect(result).not.toSuggest("deploy");
      });
    });
  });
});
