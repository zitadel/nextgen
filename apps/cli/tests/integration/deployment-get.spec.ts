import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("deployment get", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "get",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("reads back a deployment by id", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
        const data = app.envelopeOf<{ id: string; release_id: string }>(result).data;
        expect(data.id).toBe(deployed.deployment_id);
        expect(data.release_id).toBe(deployed.release_id);
      });

      it("reports an unknown deployment as not found", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "get",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });
});
