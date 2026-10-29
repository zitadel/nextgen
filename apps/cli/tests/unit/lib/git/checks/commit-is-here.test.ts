import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

describe("CommitIsHere", () => {
  it.each(["abcd", SHA, "ABCDEF12", "f".repeat(64)])(
    "passes for %s in local history",
    async (commit) => {
      expect(await new CommitIsHere(commit).problem(fakeGit(() => ({})))).toBeNull();
    },
  );

  it.each([1, 128])("fails for a commit not in local history (git exits %i)", async (exitCode) => {
    expect(await new CommitIsHere(SHA).problem(fakeGit(() => ({ exitCode })))).toBe(
      `${SHA} is not in this repository's history`,
    );
  });

  it.each(["HEAD", "--output=/tmp/x", "", "abc", "a".repeat(65), "abcg"])(
    "fails for %j without asking git",
    async (commit) => {
      const git = fakeGit(() => {
        throw new Error("git was asked");
      });

      expect(await new CommitIsHere(commit).problem(git)).toBe(`${commit} is not a commit id`);
    },
  );
});
