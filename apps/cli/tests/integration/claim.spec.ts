import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

/** Prints the link and gives up quickly, rather than opening a browser and waiting. */
const WITHOUT_A_BROWSER = ["claim", "--no-open", "--timeout", "1", "--json"];

/** Waits long enough for the claim to be completed out of band. */
const WAITING_FOR_A_BROWSER = ["claim", "--no-open", "--timeout", "10", "--json"];

describe("claim", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(WITHOUT_A_BROWSER);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
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

    it("claims the project once the challenge is completed", async () => {
      const app = await aSetUpApp();
      platform.completesTheNextClaim();

      const result = await app.run(WAITING_FOR_A_BROWSER);

      expect(result).toSucceed();
    }, 30000);

    it("reports nothing minted on a dry run", async () => {
      const app = await aSetUpApp();

      const result = await app.run([...WITHOUT_A_BROWSER, "--dry-run"]);

      expect(result).toBeSkipped();
    });
  });
});
