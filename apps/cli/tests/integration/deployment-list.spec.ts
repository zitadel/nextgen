import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("deployment list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.run(["deployment", "list", "--json"])).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("is empty before anything is deployed", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(0);
      });

      it("lists the deployment after a deploy", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(1);
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the deployed release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list"]);

        expect(result).toPrint(deployed.release_id ?? "");
      });
    });
  });
});
