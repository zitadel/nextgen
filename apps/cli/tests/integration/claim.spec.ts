import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

/** Prints the link and gives up quickly, rather than opening a browser and waiting. */
const WITHOUT_A_BROWSER = ["claim", "--no-open", "--timeout", "1", "--json"];

describe("claim", () => {
  describe("against an unavailable platform", () => {
    it("fails when the platform is unavailable", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.run(WITHOUT_A_BROWSER);

      expect(result).toFail();
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });

      it("gives up when nobody completes the claim in time", async () => {
        const app = await aSetUpApp();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });
  });
});
