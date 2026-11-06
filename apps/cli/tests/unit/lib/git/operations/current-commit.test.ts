import { describe, expect, it } from "vitest";

import { CurrentCommit } from "@/lib/git/operations/current-commit";
import { fakeGit } from "@tests/helpers/git-repo";

describe("CurrentCommit", () => {
  it("gives HEAD's commit", async () => {
    expect(await new CurrentCommit().run(fakeGit(() => ({ stdout: "abc\n" })))).toBe("abc");
  });

  it("gives null before the first commit", async () => {
    expect(await new CurrentCommit().run(fakeGit(() => ({ exitCode: 1 })))).toBeNull();
  });
});
