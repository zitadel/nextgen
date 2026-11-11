import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

/**
 * A set-up project with passkey turned off, so enabling it has something to do.
 *
 * @returns The project.
 */
async function anAppWithoutPasskey(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasDisabledMethod("passkey");
  return app;
}

describe("auth-method passkey enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey on", async () => {
        const app = await anAppWithoutPasskey();
        platform.isNotZitadel();

        const result = await app.enableMethod("passkey");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still turns passkey on", async () => {
        const app = await anAppWithoutPasskey();
        platform.isUnavailable();

        const result = await app.enableMethod("passkey");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "passkey", "enable"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns passkey on", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethod("passkey");

        expect(result).toSucceed();
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await anAppWithoutPasskey();
        await app.publishData();

        await app.enableMethod("passkey");

        expect(await app.publishedAuthMethods()).toHaveProperty("passkey", { enabled: false });
      });

      describe("under --dry-run", () => {
        it("succeeds", async () => {
          const app = await anAppWithoutPasskey();

          const result = await app.enableMethod("passkey", ["--dry-run"]);

          expect(result).toSucceed();
        });

        it("writes nothing", async () => {
          const app = await anAppWithoutPasskey();
          const files = await app.snapshot();

          await app.enableMethod("passkey", ["--dry-run"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("once deployed", () => {
        it("publishes passkey as on", async () => {
          const app = await anAppWithoutPasskey();

          await app.enableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("passkey", { enabled: true });
        });

        it("leaves nothing left to deploy", async () => {
          const app = await anAppWithoutPasskey();

          await app.enableMethod("passkey");

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it enabled, and for which schema", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toPrint("Enabled passkey for default-human-user");
      });

      it("warns when no login flow offers passkey yet", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toSay("No login flow for default-human-user offers passkey yet");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toPrintNoJson();
      });
    });
  });
});
