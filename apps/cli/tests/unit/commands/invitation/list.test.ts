import { describe, expect, it } from "vitest";

import InvitationList from "@/commands/invitation/list";
import { parseFlag } from "@tests/helpers/inputs";

describe("invitation list", () => {
  describe("with --limit", () => {
    it("takes a page size the server accepts", async () => {
      await expect(parseFlag(InvitationList.flags.limit, "50", "limit")).resolves.toBe(50);
    });

    it.each([
      ["zero", "0"],
      ["more than 100", "101"],
      ["a fraction", "2.5"],
    ])("refuses %s, saying which sizes it takes", async (_, value) => {
      await expect(parseFlag(InvitationList.flags.limit, value, "limit")).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Use a whole number from 1 to 100.",
      });
    });
  });
});
