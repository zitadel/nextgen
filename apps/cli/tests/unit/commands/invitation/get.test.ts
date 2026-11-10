import { describe, expect, it } from "vitest";

import InvitationGet from "@/commands/invitation/get";
import { parseArg } from "@tests/helpers/inputs";

const INVITATION = "inv_01JCQK5R7T9V1X3Z5B7D9F1H3J";

describe("invitation get", () => {
  describe("with invitation_id", () => {
    it("takes an invitation id, trimmed", async () => {
      await expect(
        parseArg(InvitationGet.args.invitation_id, ` ${INVITATION}\n`, "invitation_id"),
      ).resolves.toBe(INVITATION);
    });

    it.each([
      ["a blank", "   "],
      ["a space inside", "inv_has space"],
    ])("refuses %s, saying where to list invitations", async (_, value) => {
      await expect(
        parseArg(InvitationGet.args.invitation_id, value, "invitation_id"),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Find one with `zitadel invitation list`.",
      });
    });
  });
});
