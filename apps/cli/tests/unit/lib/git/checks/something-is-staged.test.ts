import { describe, expect, it } from "vitest";

import { SomethingIsStaged } from "../../../../../src/lib/git/checks/something-is-staged";
import { fakeGit } from "../../../../helpers/git-repo";

describe("SomethingIsStaged", () => {
  it("passes when something is staged", async () => {
    expect(
      await new SomethingIsStaged().problem(fakeGit(() => ({ stdout: "a.txt\0" }))),
    ).toBeNull();
  });

  it("fails when nothing is", async () => {
    expect(await new SomethingIsStaged().problem(fakeGit(() => ({})))).toBe(
      "there was nothing to commit",
    );
  });
});
