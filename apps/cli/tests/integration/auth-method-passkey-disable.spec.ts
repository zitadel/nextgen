import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

describe("auth-method passkey disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey off", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.disableMethod("passkey");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still turns passkey off", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.disableMethod("passkey");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "passkey", "disable", "--force"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns passkey off", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethod("passkey");

        expect(result).toSucceed();
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await aSetUpApp();

        await app.disableMethod("passkey");

        expect(await app.publishedAuthMethods()).toHaveProperty("passkey", { enabled: true });
      });

      it("refuses on a project whose login starts with a passkey", async () => {
        const app = await aSetUpApp(["--preset", "passkey-first"]);

        const result = await app.disableMethod("passkey");

        expect(result).toFailWith("E_VALIDATION");
      });

      describe("removing the last way to sign in without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toSuggestExactly(
            `auth-method passkey disable --schema default-human-user --cwd ${app.path} --force`,
          );
        });

        it("disables nothing", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");
          const files = await app.snapshot();

          await app.disableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("when passkey is already off", () => {
        it("succeeds again", async () => {
          const app = await aSetUpApp();
          await app.hasDisabledMethod("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toSucceed();
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          await app.hasDisabledMethod("passkey");
          const files = await app.snapshot();

          await app.disableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("once deployed", () => {
        it("publishes passkey as off", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("passkey", { enabled: false });
        });

        it("keeps password on", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("password", { enabled: true });
        });

        it("leaves nothing left to deploy", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it disabled, and for which schema", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrint("Disabled passkey for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrintNoJson();
      });
    });
  });
});
