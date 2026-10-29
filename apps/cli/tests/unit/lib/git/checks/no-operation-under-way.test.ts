import { describe, expect, it } from "vitest";

import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { fakeGit } from "../../../../helpers/git-repo";

/** A git whose markers are at `.git/<name>`, of which `existing` exist. */
function gitWith(existing: string[]) {
  const markers = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
  ];
  return fakeGit(
    () => ({ stdout: `${markers.map((marker) => `.git/${marker}`).join("\n")}\n` }),
    existing.map((marker) => `.git/${marker}`),
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
  ])("fails while %s is there", async (marker, problem) => {
    expect(await new NoOperationUnderWay().problem(gitWith([marker]))).toBe(problem);
  });
});
