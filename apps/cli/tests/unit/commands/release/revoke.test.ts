import { describe, expect, it } from "vitest";

import ReleaseRevoke, { inUseError } from "@/commands/release/revoke";
import { parseArg } from "@tests/helpers/inputs";

const RELEASE = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

describe("release_id", () => {
  it("takes a release id, trimmed", async () => {
    await expect(
      parseArg(ReleaseRevoke.args.release_id, ` ${RELEASE}\n`, "release_id"),
    ).resolves.toBe(RELEASE);
  });

  it.each([
    ["a deployment id", "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    ["a blank", "   "],
    ["a prefix alone", "rel_"],
    ["a space inside", "rel_has space"],
  ])("refuses %s, saying what a release id is and where to list them", async (_, value) => {
    await expect(
      parseArg(ReleaseRevoke.args.release_id, value, "release_id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("must be a release ID"),
      hint: "Find one with `zitadel release list`.",
    });
  });
});

describe("inUseError", () => {
  const primary = {
    origin: "https://app.acme.com",
    deployment_id: "dep_1",
    kind: "primary",
  } as const;
  const preview = {
    origin: "https://x-acme.vercel.app",
    deployment_id: "dep_2",
    kind: "preview",
  } as const;

  it("names each origin and the deployment that pins it", () => {
    expect(inUseError(RELEASE, [primary, preview])).toMatchObject({
      code: "E_CONFLICT",
      message: `${RELEASE} is still served by https://app.acme.com (dep_1), https://x-acme.vercel.app (dep_2)`,
    });
  });

  it("names the first three origins and counts the rest", () => {
    const origins = [1, 2, 3, 4, 5].map((n) => {
      return {
        origin: `https://${n}.acme.com`,
        deployment_id: `dep_${n}`,
        kind: "primary",
      } as const;
    });

    expect(inUseError(RELEASE, origins).message).toBe(
      `${RELEASE} is still served by https://1.acme.com (dep_1), https://2.acme.com (dep_2), https://3.acme.com (dep_3) and 2 more`,
    );
  });

  it("carries every origin in its details", () => {
    expect(inUseError(RELEASE, [primary, preview]).details).toEqual({
      release_id: RELEASE,
      origins: [primary, preview],
    });
  });

  it.each([
    [
      "a primary origin",
      [primary],
      "Deploy another release to the primary origins, or roll the deployment back, then revoke it.",
    ],
    ["a preview", [preview], "Remove the preview, then revoke it."],
    [
      "both",
      [primary, preview],
      "Remove the preview, and deploy another release to the primary origins or roll the deployment back, then revoke it.",
    ],
  ])("says what frees %s", (_, origins, hint) => {
    expect(inUseError(RELEASE, origins).hint).toBe(hint);
  });
});
