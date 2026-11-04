import { describe, expect, it } from "vitest";

import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { fakeGit } from "../../../../helpers/git-repo";

/** A git that keeps each marker at `worktrees/w/<marker>`, as a linked worktree does, of which `existing` exist. */
function gitWith(existing: string[]) {
  return fakeGit(
    (args) => ({
      stdout: `${args
        .filter((_, index) => args[index - 1] === "--git-path")
        .map((marker) => `worktrees/w/${marker}`)
        .join("\n")}\n`,
    }),
    existing.map((marker) => `worktrees/w/${marker}`),
  );
}

describe("NoOperationUnderWay", () => {
  it("passes with nothing under way", async () => {
    expect(await new NoOperationUnderWay().problem(gitWith([]))).toBeNull();
  });

  it.each([
    ["a merge", "MERGE_HEAD", "a merge is in progress"],
    ["an interactive rebase", "rebase-merge", "a rebase is in progress"],
    ["a patch-based rebase", "rebase-apply", "a rebase is in progress"],
    ["a cherry-pick", "CHERRY_PICK_HEAD", "a cherry-pick is in progress"],
    ["a revert", "REVERT_HEAD", "a revert is in progress"],
    ["a bisect", "BISECT_LOG", "a bisect is in progress"],
  ])("fails during %s", async (_, marker, problem) => {
    expect(await new NoOperationUnderWay().problem(gitWith([marker]))).toBe(problem);
  });
});
