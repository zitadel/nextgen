import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { fakeGit } from "../../../../helpers/git-repo";

describe("HeadIsOnABranch", () => {
  it("passes when HEAD names a branch", async () => {
    expect(
      await new HeadIsOnABranch().problem(fakeGit(() => ({ stdout: "refs/heads/main\n" }))),
    ).toBeNull();
  });

  it("fails on a detached HEAD", async () => {
    expect(await new HeadIsOnABranch().problem(fakeGit(() => ({ exitCode: 1 })))).toBe(
      "HEAD is detached, so the commit would be on no branch",
    );
  });
});
