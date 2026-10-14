import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

type Release = { release_id: string; content_hash: string; resources: number };

function createRelease(app: ScaffoldedApp) {
  return app.run(["release", "create", "--non-interactive", "--json"]);
}

describe("release create", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await createRelease(app)).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await createRelease(app)).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("builds a release from the config without deploying it", async () => {
        const app = await aSetUpApp();

        const result = await createRelease(app);

        expect(result).toSucceed();
        const data = app.envelopeOf<Release>(result).data;
        expect(data.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(0);
      });

      it("registers a new sign-in provider the release names", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });

        await createRelease(app);

        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });

      it("creates no release on a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "release",
          "create",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        const data = app.envelopeOf<Release & { dry_run: boolean }>(result).data;
        expect(data.dry_run).toBe(true);
        expect(data.release_id).toBeUndefined();
      });

      it("returns the same release for the same content", async () => {
        const app = await aSetUpApp();

        const first = app.envelopeOf<Release>(await createRelease(app)).data;
        const again = app.envelopeOf<Release>(await createRelease(app)).data;

        expect(again.release_id).toBe(first.release_id);
      });
    });

    describe("rendered for a terminal", () => {
      it("names the release it created", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["release", "create", "--non-interactive"]);

        expect(result).toPrint("Created rel_");
      });
    });
  });
});
