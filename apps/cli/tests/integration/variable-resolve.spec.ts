import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

type Resolved = { variables: { name: string; value?: string }[] };

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

      it("shows the variables the live deployment froze", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        expect(await app.setVariable("API_URL", "https://api.acme.com")).toSucceed();
        await app.deployData();

        const result = await app.resolveVariables();

        expect(result).toSucceed();
        expect(app.envelopeOf<Resolved>(result).data.variables).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("serves the frozen value, not a later write to the store", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        expect(await app.setVariable("API_URL", "https://api.acme.com")).toSucceed();
        await app.deployData();
        expect(await app.setVariable("API_URL", "https://api.changed.com")).toSucceed();

        const result = await app.resolveVariables();

        expect(app.envelopeOf<Resolved>(result).data.variables).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("is a miss for an origin with nothing deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://not-deployed.acme.com" });

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });
  });
});
