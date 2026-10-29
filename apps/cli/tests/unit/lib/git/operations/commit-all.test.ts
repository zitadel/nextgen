import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { CommitAll } from "../../../../../src/lib/git/operations/commit-all";

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
});
