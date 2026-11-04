import { describe, expect, it } from "vitest";

import { CurrentCommit } from "../../../../../src/lib/git/operations/current-commit";
import { fakeGit } from "../../../../helpers/git-repo";

describe("CurrentCommit", () => {
  it("gives HEAD's commit", async () => {
    expect(await new CurrentCommit().run(fakeGit(() => ({ stdout: "abc\n" })))).toBe("abc");
  });

  it("gives null before the first commit", async () => {
    expect(await new CurrentCommit().run(fakeGit(() => ({ exitCode: 1 })))).toBeNull();
  });
});
