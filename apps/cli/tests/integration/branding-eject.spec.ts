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
      it("starts from the default design when none is named and no one can be asked", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["branding", "eject", "--non-interactive", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ design: string }>(result).data.design).toEqual(expect.any(String));
      });

      it("publishes nothing by itself", async () => {
        const published = platform.capturesBrandingPublishes();
        const app = await aSetUpApp();

        const result = await app.run(MINIMAL_DESIGN);

        expect(result).toSucceed();
        expect(published.count).toBe(0);
      });

      it("carries the ejected design into the next deploy's release", async () => {
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();
        await app.addPrimaryOrigin();

        const data = await app.deployData();

        // The scaffold's schema and flow, plus the ejected branding.
        expect(data.resources).toBe(3);
      });

      it("re-deploys the same release once the design is published", async () => {
        const app = await aSetUpApp();
        expect(await app.run(MINIMAL_DESIGN)).toSucceed();
        await app.addPrimaryOrigin();
        const before = await app.deployData();

        const after = await app.deployData();

        expect(after.content_hash).toBe(before.content_hash);
      });
    });
  });
});
