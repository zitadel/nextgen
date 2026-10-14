import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** Build a release and return its id. */
async function aRelease(app: ScaffoldedApp): Promise<string> {
  const result = await app.run(["release", "create", "--non-interactive", "--json"]);
  expect(result, "arranging a release should have succeeded").toSucceed();
  return app.envelopeOf<{ release_id: string }>(result).data.release_id;
}

describe("release revoke", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "release",
          "revoke",
          "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("revokes a release nothing serves", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(
          app.envelopeOf<{ revoked_at: string | null }>(result).data.revoked_at,
        ).not.toBeNull();
      });

      it("revokes nothing on a dry run, needing no --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const releaseId = await aRelease(app);

        // A dry run is exempt from the destructive-confirm gate, so it succeeds
        // without --force even non-interactively.
        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ dry_run: boolean }>(result).data.dry_run).toBe(true);

        // The release was not revoked: it can still be deployed, which a
        // revoked release refuses.
        const deployed = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);
        expect(deployed).toSucceed();
      });

      it("refuses to revoke a release an origin still serves", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const served = await app.deployData();

        const result = await app.run([
          "release",
          "revoke",
          served.release_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_CONFLICT");
      });

      it("requires --force when non-interactive", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });
});
