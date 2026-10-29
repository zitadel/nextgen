import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

describe("CommitIsHere", () => {
  it("passes for a commit in local history", async () => {
    expect(await new CommitIsHere(SHA).problem(fakeGit(() => ({})))).toBeNull();
  });

  it("fails for a commit not in local history", async () => {
    expect(await new CommitIsHere(SHA).problem(fakeGit(() => ({ exitCode: 1 })))).toBe(
      `${SHA} is not in this repository's history`,
    );
  });

  it.each(["HEAD", "--output=/tmp/x", ""])("fails for %j without asking git", async (commit) => {
    const git = fakeGit(() => {
      throw new Error("git was asked");
    });

    expect(await new CommitIsHere(commit).problem(git)).toBe(`${commit} is not a commit id`);
  });
});
