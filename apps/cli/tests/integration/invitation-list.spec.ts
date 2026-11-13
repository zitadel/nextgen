import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const LIST = ["invitation", "list"];

const platform = usePlatformMock();

describe("invitation list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([...LIST, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run([...LIST, "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileInvitation();

      await app.inEveryRendering((how) => app.run(how.json ? [...LIST, "--json"] : LIST, how.env));
    });

    describe("--json", () => {
      it("lists the project's invitations, newest first", async () => {
        const app = await aSetUpApp();
        const older = await app.invite();
        const newer = await app.invite();

        const result = await app.run([...LIST, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          items: [{ id: newer }, { id: older }],
          count: 2,
        });
      });

      it("is empty for a project that invited nobody", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...LIST, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ items: [], count: 0 });
      });

      it("narrows to one status with --status", async () => {
        const app = await aSetUpApp();
        const accepted = await app.invite();
        const pending = await app.invite();
        platform.acceptsInvitation(accepted);

        const result = await app.run([...LIST, "--status", "pending", "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ items: [{ id: pending }], count: 1 });
      });

      it("leaves accepted invitations out without --status", async () => {
        const app = await aSetUpApp();
        const accepted = await app.invite();
        const pending = await app.invite();
        platform.acceptsInvitation(accepted);

        const result = await app.run([...LIST, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ items: [{ id: pending }], count: 1 });
      });

      it("lists every status --status names when it repeats", async () => {
        const app = await aSetUpApp();
        const accepted = await app.invite();
        const pending = await app.invite();
        platform.acceptsInvitation(accepted);

        const result = await app.run([
          ...LIST,
          "--status",
          "pending",
          "--status",
          "accepted",
          "--json",
        ]);

        expect(app.envelopeOf(result).data).toMatchObject({
          items: [{ id: pending }, { id: accepted }],
          count: 2,
        });
      });

      it("narrows to one type with --type", async () => {
        const app = await aSetUpApp();
        await app.invite();

        const result = await app.run([...LIST, "--type", "team_member", "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ items: [], count: 0 });
      });

      it("reports the next page when --limit cuts the list short", async () => {
        const app = await aSetUpApp();
        await app.invite();
        await app.invite();

        const result = await app.run([...LIST, "--limit", "1", "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          count: 1,
          next_page_token: expect.any(String),
        });
      });

      it("never carries an invitation's link", async () => {
        const app = await aSetUpApp();
        await app.invite();

        const result = await app.run([...LIST, "--json"]);

        expect(result.stdout).not.toContain("#token=");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints each invitation as a record", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(LIST);

        expect(result).toPrintPlainRow(invitation, "", "viewer", "pending", /^\d{4}-/);
      });

      it("spells out a name holding a control character", async () => {
        const app = await aSetUpApp();
        platform.servesAHostileInvitation();

        const result = await app.run(LIST);

        expect(result).toPrint("Ada\\x1b[2Jwiped");
      });
    });
  });
});
