import { describe, expect, it } from "vitest";

import Claim from "@/commands/claim/index";
import { parseFlag } from "@tests/helpers/inputs";

const CHALLENGE = "ch_01KX5N7C9D2E7F0N9WD3P2E4YM6";

describe("--challenge-id", () => {
  it("takes a challenge id, trimmed", async () => {
    await expect(
      parseFlag(Claim.flags["challenge-id"], ` ${CHALLENGE}\n`, "challenge-id"),
    ).resolves.toBe(CHALLENGE);
  });

  it.each([
    ["a deployment id", "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    ["a blank", "   "],
    ["a prefix alone", "ch_"],
    ["a space inside", "ch_has space"],
  ])("refuses %s, saying what the challenge id is and how to get one", async (_, value) => {
    await expect(
      parseFlag(Claim.flags["challenge-id"], value, "challenge-id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("starts with ch_"),
    });
  });
});
