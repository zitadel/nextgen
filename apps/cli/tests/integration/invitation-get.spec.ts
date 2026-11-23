import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { asTerminal, RENDERINGS } from "@tests/fixtures/terminal";

const UNKNOWN = "inv_missing";

const platform = usePlatformMock();

describe("invitation get", () => {
  describe("--fields", () => {
    it("judges the fields by the record's shape", async () => {
      const app = await aSetUpApp();
      const invitation = await app.invite();

      const refused = await app.run([
        "invitation",
        "get",
        invitation,
        "--fields",
        "no_such_field",
        "--json",
      ]);

      expect(refused).toFailWith("E_VALIDATION");
      expect(JSON.parse(refused.stdout).hint).toContain("status");
    });

    it("cuts the data to the fields chosen", async () => {
      const app = await aSetUpApp();
      const invitation = await app.invite();

      const result = await app.run([
        "invitation",
        "get",
        invitation,
        "--fields",
        "id,status",
        "--json",
      ]);

      expect(app.envelopeOf(result).data).toEqual({
        title: `Read ${invitation}`,
        id: invitation,
        status: "pending",
      });
    });

    it("prints only the fields chosen", async () => {
      const app = await aSetUpApp();
      const invitation = await app.invite();

      const result = await app.run(["invitation", "get", invitation, "--fields", "status"]);

      expect(result).toPrintRow("status", "pending");
      expect(result).not.toPrintRow("role");
    });
  });

  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["invitation", "get", UNKNOWN, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["invitation", "get", UNKNOWN, "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileInvitation();
      const args = ["invitation", "get", "inv_hostile"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reads one invitation", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "get", invitation, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          id: invitation,
          status: "pending",
          project_member: { relation: "viewer" },
        });
      });

      it("reads an accepted invitation as accepted", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();
        platform.acceptsInvitation(invitation);

        const result = await app.run(["invitation", "get", invitation, "--json"]);

        expect(app.envelopeOf(result).data).toMatchObject({ status: "accepted" });
      });

      it("never carries the invitation's link", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "get", invitation, "--json"]);

        expect(result.stdout).not.toContain("#token=");
      });

      it("refuses an invitation the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["invitation", "get", UNKNOWN, "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("refuses an id the API could not hold without asking it", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["invitation", "get", "not an id", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the invitation as plain text when piped", async () => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await app.run(["invitation", "get", invitation]);

        expect(result).toPrintRow("status", "pending");
      });

      it.each(RENDERINGS)("shows the invitation's role, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        const invitation = await app.invite();

        const result = await asTerminal(() => app.run(["invitation", "get", invitation], colour));

        expect(result).toPrintRow("role", "viewer");
      });

      it("spells out a name holding a control character", async () => {
        const app = await aSetUpApp();
        platform.servesAHostileInvitation();

        const result = await asTerminal(() => app.run(["invitation", "get", "inv_hostile"]));

        expect(result).toPrint("Ada\\x1b[2Jwiped");
      });
    });
  });
});
