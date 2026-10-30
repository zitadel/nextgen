import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

describe("CommitIsHere", () => {
  it.each([
    ["a full SHA-1 id", SHA],
    ["an abbreviated id", "abcd"],
    ["an id in capitals", "ABCDEF12"],
    ["a full SHA-256 id", "f".repeat(64)],
  ])("passes for %s in local history", async (_, commit) => {
    expect(await new CommitIsHere(commit).problem(fakeGit(() => ({})))).toBeNull();
  });

  it.each([
    ["git says it is missing", 1],
    ["git cannot resolve it", 128],
  ])("fails for a commit not in local history when %s", async (_, exitCode) => {
    expect(await new CommitIsHere(SHA).problem(fakeGit(() => ({ exitCode })))).toBe(
      `${SHA} is not in this repository's history`,
    );
  });

  it.each([
    ["a branch name", "HEAD"],
    ["an option", "--output=/tmp/x"],
    ["nothing", ""],
    ["an id too short", "abc"],
    ["an id too long", "a".repeat(65)],
    ["an id with a letter outside hex", "abcg"],
  ])("fails for %s without asking git", async (_, commit) => {
    const git = fakeGit(() => {
      throw new Error("git was asked");
    });

    expect(await new CommitIsHere(commit).problem(git)).toBe(`${commit} is not a commit id`);
  });
});
