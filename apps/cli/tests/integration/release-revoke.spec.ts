import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/** Build a release and return its id. */
async function aRelease(app: ScaffoldedApp): Promise<string> {
  // Setup deployed the scaffolded config, so the release is built from an
  // edit of it: one nothing serves.
  await app.editUserSchema((schema) => {
    schema.properties.company = { type: "string" };
  });
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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["release", "revoke", await aRelease(app), "--force"];
      platform.revokesAHostileReleaseId();

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses a deployment id, which is not a release id, without asking", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "release",
          "revoke",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("suggests listing releases when given a deployment id", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "release",
          "revoke",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toSuggest("release list");
      });

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

      // The confirmation names the id the server answered with.
      it("spells out an escape sequence the server put in the release id", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.revokesAHostileReleaseId();

        const result = await app.run([
          "release",
          "revoke",
          releaseId,
          "--force",
          "--non-interactive",
        ]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });

      it("confirms the revoke the way every revoke does", async () => {
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

        expect(app.envelopeOf<{ revoked: boolean }>(result).data.revoked).toBe(true);
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

      it("names the origin that serves the release and the deployment that pins it", async () => {
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

        expect(result).toExplain(`https://app.example.com (${served.deployment_id ?? ""})`);
      });

      it.each(["deploy", "deployment rollback"])(
        "suggests %s for a release an origin still serves",
        async (command) => {
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

          expect(result).toSuggest(command);
        },
      );

      describe("on a release only a preview serves", () => {
        const PREVIEW_URL = "https://x-acme.vercel.app";

        /** A release built and served by a preview of an edit nothing else serves. */
        async function aPreviewedRelease(app: ScaffoldedApp): Promise<string> {
          await app.addOrigin("https://*-acme.vercel.app", "preview");
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });
          const previewed = await app.previewData(PREVIEW_URL);
          return String(previewed.release_id);
        }

        it("suggests removing the preview", async () => {
          const app = await aSetUpApp();
          const releaseId = await aPreviewedRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--force", "--json"]);

          expect(result).toSuggest(`preview rm ${PREVIEW_URL}`);
        });

        it("does not suggest a deploy or a rollback, which leave the preview serving it", async () => {
          const app = await aSetUpApp();
          const releaseId = await aPreviewedRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--force", "--json"]);

          expect(result).not.toSuggest("deployment rollback");
        });
      });

      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();
          const releaseId = await aRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          const releaseId = await aRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--json"]);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          const releaseId = await aRelease(app);

          const result = await app.run(["release", "revoke", releaseId, "--json"]);

          expect(result).toSuggestExactly(app.againAsRun(`release revoke ${releaseId} --force`));
        });

        it("revokes nothing", async () => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const releaseId = await aRelease(app);

          await app.run(["release", "revoke", releaseId, "--json"]);

          expect(
            await app.run(["deployment", "create", "--release", releaseId, "--json"]),
          ).toSucceed();
        });
      });
    });
  });
});
