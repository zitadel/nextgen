import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const CREATE = ["invitation", "create", "--relation", "viewer"];

const platform = usePlatformMock();

describe("invitation create", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([...CREATE, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run([...CREATE, "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.mintsAHostileInvitation();

      await app.inEveryRendering((how) =>
        app.run(how.json ? [...CREATE, "--json"] : CREATE, how.env),
      );
    });

    describe("--json", () => {
      it("answers the link to share", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...CREATE, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          status: "pending",
          project_member: { relation: "viewer" },
          link: expect.stringMatching(/#token=\S+$/),
        });
      });

      it("creates an invitation the project lists", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...CREATE, "--json"]);

        expect(await app.invitationIds()).toEqual([app.envelopeOf(result).data.id]);
      });

      it("keeps its link out of a later list", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...CREATE, "--json"]);

        expect(await app.invitationListing()).not.toContain(
          String(app.envelopeOf(result).data.link),
        );
      });

      it("keeps its link out of a later read", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...CREATE, "--json"]);

        const created = app.envelopeOf(result).data;
        expect(await app.invitationReading(String(created.id))).not.toContain(String(created.link));
      });

      it("is refused without --relation when no one can be asked", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["invitation", "create", "--json"]);

        expect(result).toFail();
      });

      it("creates nothing without --relation when no one can be asked", async () => {
        const app = await aSetUpApp();

        await app.run(["invitation", "create", "--json"]);

        expect(await app.invitationIds()).toEqual([]);
      });

      it("replaces a pending invitation with a new one", async () => {
        const app = await aSetUpApp();
        const original = await app.invite();

        const result = await app.run([...CREATE, "--replaces", original, "--json"]);

        expect(await app.invitationIds()).toEqual([app.envelopeOf(result).data.id]);
      });

      it("refuses to replace an accepted invitation", async () => {
        const app = await aSetUpApp();
        const accepted = await app.invite();
        platform.acceptsInvitation(accepted);

        const result = await app.run([...CREATE, "--replaces", accepted, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("creates nothing when the invitation it replaces was accepted", async () => {
        const app = await aSetUpApp();
        const accepted = await app.invite();
        platform.acceptsInvitation(accepted);

        await app.run([...CREATE, "--replaces", accepted, "--json"]);

        expect(await app.invitationIds()).toEqual([accepted]);
      });

      it("refuses to replace an invitation the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...CREATE, "--replaces", "inv_missing", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("creates nothing on a dry run", async () => {
        const app = await aSetUpApp();

        await app.run([...CREATE, "--dry-run", "--json"]);

        expect(await app.invitationIds()).toEqual([]);
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the link to share", async () => {
        const app = await aSetUpApp();

        const result = await app.run(CREATE);

        expect(result).toPrint("/invitations/accept#token=");
      });

      it("spells out a link holding a control character", async () => {
        const app = await aSetUpApp();
        platform.mintsAHostileInvitation();

        const result = await app.run(CREATE);

        expect(result).toPrint("#token=\\x1b[2Jwiped");
      });
    });
  });
});
