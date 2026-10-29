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
    ["MERGE_HEAD", "a merge is in progress"],
    ["rebase-merge", "a rebase is in progress"],
    ["rebase-apply", "a rebase is in progress"],
    ["CHERRY_PICK_HEAD", "a cherry-pick is in progress"],
    ["REVERT_HEAD", "a revert is in progress"],
    ["BISECT_LOG", "a bisect is in progress"],
  ])("fails while %s is where git keeps it", async (marker, problem) => {
    expect(await new NoOperationUnderWay().problem(gitWith([marker]))).toBe(problem);
  });
});
