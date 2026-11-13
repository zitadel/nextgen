import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const UNKNOWN = "inv_missing";

const platform = usePlatformMock();

describe("invitation cancel", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["invitation", "cancel", UNKNOWN, "--force", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["invitation", "cancel", UNKNOWN, "--force", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });

      it("refuses a bare cancel without asking it", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["invitation", "cancel", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const invitation = await app.invite();
      const args = ["invitation", "cancel", invitation, "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("cancels a pending invitation", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "cancel", invitation, "--force", "--json"]);

        expect(result).toSucceed();
      });

      it("leaves the project without the invitation", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        await app.run(["invitation", "cancel", invitation, "--force", "--json"]);

        expect(await app.invitationIds()).toEqual([]);
      });

      it("refuses an accepted invitation", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();
        platform.acceptsInvitation(invitation);

        const result = await app.run(["invitation", "cancel", invitation, "--force", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses an invitation the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["invitation", "cancel", UNKNOWN, "--force", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("refuses a bare cancel when no one can be asked", async () => {
        const app = await aSetUpApp();
        await app.invite();

        const result = await app.run(["invitation", "cancel", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("without --force when no one can be asked", () => {
      it("is refused for confirmation", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "cancel", invitation, "--json"]);

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
      });

      it("cancels nothing", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        await app.run(["invitation", "cancel", invitation, "--json"]);

        expect(await app.invitationIds()).toEqual([invitation]);
      });
    });

    describe("a dry run", () => {
      it("cancels nothing", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        await app.run(["invitation", "cancel", invitation, "--dry-run", "--json"]);

        expect(await app.invitationIds()).toEqual([invitation]);
      });
    });

    describe("rendered for a terminal", () => {
      it("names the invitation it cancelled", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "cancel", invitation, "--force"]);

        expect(result).toPrint(invitation);
      });
    });
  });
});
