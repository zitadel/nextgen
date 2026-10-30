import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { ReadyToCommit } from "../../../../../src/lib/git/operations/ready-to-commit";

describe("ReadyToCommit", () => {
  it("is checked for an operation under way and a detached HEAD", () => {
    expect(new ReadyToCommit().checks().map((check) => check.constructor)).toEqual([
      NoOperationUnderWay,
      HeadIsOnABranch,
    ]);
  });

  it("answers with the problem a check found", () => {
    expect(new ReadyToCommit().refused("a merge is in progress")).toBe("a merge is in progress");
  });

  it("answers null when every check holds", async () => {
    expect(await new ReadyToCommit().run()).toBeNull();
  });
});
