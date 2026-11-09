import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

describe("auth-method password enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableMethod("password");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.enableMethod("password");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "password", "enable"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("refuses a schema with no x-identifier to check a password against", async () => {
        const app = await aSetUpApp();
        await app.lacksAnIdentifier();
        await app.hasTurnedOffByHand("password");

        const result = await app.enableMethod("password");

        expect(result).toFailWith("E_VALIDATION");
      });

      describe("when password is already on", () => {
        it("succeeds", async () => {
          const app = await aSetUpApp();

          const result = await app.enableMethod("password");

          expect(result).toSucceed();
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.enableMethod("password");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("leaves nothing to publish", async () => {
          const app = await aSetUpApp();
          const before = await app.publishData();

          await app.enableMethod("password");

          expect((await app.deployData()).content_hash).toBe(before.content_hash);
        });
      });

      describe("once deployed", () => {
        it("publishes password as on after it was switched off by hand", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          await app.enableMethod("password");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("password", {
            enabled: true,
          });
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says there was nothing to enable", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethodRendered("password");

        expect(result).toPrint("Nothing to enable for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethodRendered("password");

        expect(result).toPrintNoJson();
      });
    });
  });
});
