import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const MINIMAL_DESIGN = ["branding", "eject", "--design", "minimal", "--non-interactive", "--json"];

describe("branding eject", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("publishes nothing by itself", async () => {
        const published = platform.capturesBrandingPublishes();
        const app = await aSetUpApp();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
        expect(published.count).toBe(0);
      });

      it("publishes the ejected design on the next apply", async () => {
        const published = platform.capturesBrandingPublishes();
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();

        const result = await app.apply();

        expect(result).toSucceed();
        expect(published.count).toBe(1);
        expect(published.last).toMatchObject({ layout: "centered" });
      });

      it("leaves nothing to reconcile once the design is published", async () => {
        platform.capturesBrandingPublishes();
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();

        expect(await app.apply()).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });
    });
  });
});
