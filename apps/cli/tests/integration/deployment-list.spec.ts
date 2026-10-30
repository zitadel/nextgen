import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anUndeployedEnvironment, aSetUpApp } from "../helpers/project";

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
        const app = await anUndeployedEnvironment();

        const result = await app.run(["deployment", "list", "--env", "staging", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(0);
      });

      it("emits the canonical list envelope", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toSucceed();
        // The envelope carries `items` (not `deployments`), a `count`, and a
        // `next_page_token` that is null on the last page — the same shape the
        // shared list commands emit.
        const { data } = app.envelopeOf<{
          items: { id: string; release_id: string }[];
          count: number;
          next_page_token: string | null;
        }>(result);
        // Setup's deployment, then this one, newest first.
        expect(data.count).toBe(2);
        expect(data.items).toHaveLength(2);
        expect(data.items[0]?.release_id).toBe(deployed.release_id);
        expect(data.next_page_token).toBeNull();
      });

      it("reads no further when a page comes back empty without --all", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.answersTheNextListWithNothing("deployments");

        expect(await app.run(["deployment", "list", "--limit", "1", "--json"])).toFail();
      });

      it("drains the history with --all", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run(["deployment", "list", "--all", "--limit", "1", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(2);
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
