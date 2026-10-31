import { describe, expect, it } from "vitest";

import { NothingExcludedIsStaged } from "../../../../../src/lib/git/checks/nothing-excluded-is-staged";
import { fakeGit } from "../../../../helpers/git-repo";

const isEnv = (path: string): boolean => path.endsWith(".env");

describe("NothingExcludedIsStaged", () => {
  it("passes when no excluded file is staged", async () => {
    expect(
      await new NothingExcludedIsStaged(isEnv).problem(fakeGit(() => ({ stdout: "a.txt\0" }))),
    ).toBeNull();
  });

  it("names the excluded file still staged", async () => {
    expect(
      await new NothingExcludedIsStaged(isEnv).problem(
        fakeGit(() => ({ stdout: "a.txt\0.env\0" })),
      ),
    ).toBe(".env could not be kept out of the commit, so nothing was committed");
  });
});
