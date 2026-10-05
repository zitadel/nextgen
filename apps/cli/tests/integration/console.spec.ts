import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("console", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses a project with no local runtime behind it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toExplain("No local admin in this directory or its parents");
      });

      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toFail();
      });
    });
  });
});
