import { describe, expect, it } from "vitest";

import InvitationCreate from "@/commands/invitation/create";
import { parseFlag } from "@tests/helpers/inputs";

const INVITATION = "inv_01JCQK5R7T9V1X3Z5B7D9F1H3J";

/** One character past the longest name the API stores. */
const TOO_LONG = "x".repeat(201);

describe("invitation create", () => {
  describe("with --name", () => {
    it("takes a name, trimmed", async () => {
      await expect(parseFlag(InvitationCreate.flags.name, "  John Doe ", "name")).resolves.toBe(
        "John Doe",
      );
    });

    it.each([
      ["a blank", "   "],
      ["a name over 200 characters", TOO_LONG],
    ])("refuses %s, saying how long a name may be", async (_, value) => {
      await expect(parseFlag(InvitationCreate.flags.name, value, "name")).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Pass a name of 1 to 200 characters, or leave --name out.",
      });
    });
  });

  describe("with --replaces", () => {
    it("takes an invitation id, trimmed", async () => {
      await expect(
        parseFlag(InvitationCreate.flags.replaces, ` ${INVITATION}\n`, "replaces"),
      ).resolves.toBe(INVITATION);
    });

    it.each([
      ["a blank", "   "],
      ["a space inside", "inv_has space"],
    ])("refuses %s, saying where to list invitations", async (_, value) => {
      await expect(
        parseFlag(InvitationCreate.flags.replaces, value, "replaces"),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Find one with `zitadel invitation list`.",
      });
    });
  });
});
