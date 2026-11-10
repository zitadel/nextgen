import { describe, expect, it } from "vitest";

import ReleaseRevoke, { RELEASE_IN_USE_REFUSAL } from "@/commands/release/revoke";
import { refusalError } from "@/lib/oclif/refusal";
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

describe("a release an origin still serves", () => {
  const origins = [{ origin: "https://app.example.com", deployment_id: "dep_1" }];
  const refusal = refusalError(RELEASE_IN_USE_REFUSAL, {
    release_id: RELEASE,
    served: "https://app.example.com (deployment dep_1)",
    origins,
  });

  it("names the release, the origin serving it and the deployment that pins it", () => {
    expect(refusal).toMatchObject({
      code: "E_CONFLICT",
      message: `Release ${RELEASE} is still served by https://app.example.com (deployment dep_1).`,
    });
  });

  it("says to deploy another release or roll back, then revoke again", () => {
    expect(refusal.hint).toBe(
      "Deploy another release with `zitadel deploy`, or roll back with `zitadel deployment rollback`, then revoke this release again.",
    );
  });

  it("lists the origins, whole, in the details", () => {
    expect(refusal.details).toEqual({ release_id: RELEASE, origins });
  });

  it("suggests deploying or rolling back", () => {
    expect(RELEASE_IN_USE_REFUSAL.next).toEqual(["deploy", "deployment rollback"]);
  });
});
