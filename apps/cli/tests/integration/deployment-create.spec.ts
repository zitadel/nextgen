import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp, SETUP_ORIGIN } from "../helpers/project";

const platform = usePlatformMock();

async function aRelease(app: ScaffoldedApp): Promise<string> {
  const result = await app.run(["release", "create", "--non-interactive", "--json"]);
  expect(result, "arranging a release should have succeeded").toSucceed();
  return app.envelopeOf<{ release_id: string }>(result).data.release_id;
}

describe("deployment create", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("makes an existing release live on every primary origin", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        const data = app.envelopeOf<{ release_id: string; origins: string[] }>(result).data;
        expect(data.release_id).toBe(releaseId);
        expect(data.origins).toEqual(["default", SETUP_ORIGIN.pattern, "https://app.acme.com"]);
      });

      it("writes no deployment on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);
        const before = await app.liveDeploymentCount();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ dry_run: boolean }>(result).data.dry_run).toBe(true);
        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("takes no --origin, as primary origins are never named one by one", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
          "--origin",
          "https://app.example.com",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails with no primary origin to deploy to", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });
});
