import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { CommitAll } from "../../../../../src/lib/git/operations/commit-all";
import { fakeGit } from "../../../../helpers/git-repo";

const OPTIONS = { except: () => false, authorIfGitHasNone: { name: "n", email: "e" } };

describe("CommitAll", () => {
  it("is checked for an operation under way and a detached HEAD", () => {
    expect(new CommitAll("m", OPTIONS).checks()).toEqual([
      new NoOperationUnderWay(),
      new HeadIsOnABranch(),
    ]);
  });

  it("commits nothing when refused, and says why", () => {
    expect(new CommitAll("m", OPTIONS).refused("why")).toEqual({ committed: false, reason: "why" });
  });

  it("throws when the commit left no HEAD behind", async () => {
    const git = fakeGit((args) => {
      if (args.includes("HEAD^{commit}")) {
        return { exitCode: 1 };
      }
      if (args.includes("--cached")) {
        return { stdout: "a.txt\0" };
      }
      return {};
    });

    await expect(new CommitAll("m", OPTIONS).run(git)).rejects.toThrow(
      "the commit left no HEAD to record",
    );
  });
});
