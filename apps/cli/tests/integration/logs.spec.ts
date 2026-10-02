import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("logs", () => {
  describe("against an unavailable platform", () => {
    it("fails", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      const result = await app.run(["logs", "--json"]);

      expect(result).toFailWith("E_VALIDATION");
    });
  });

  describe("against the platform", () => {
    describe("--json", () => {
      it("refuses when the local runtime has never been started", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["logs", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says the runtime has not been started", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["logs", "--json"]);

        expect(result).toExplain("Local Zitadel runtime has not been started");
      });
    });
  });
});
