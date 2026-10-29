import { describe, expect, it } from "vitest";

import { UncommittedFiles } from "../../../../../src/lib/git/operations/uncommitted-files";
import { fakeGit } from "../../../../helpers/git-repo";

/** The files listed when `status` prints `stdout`, from the directory at `prefix`. */
function listed(prefix: string, stdout: string) {
  return new UncommittedFiles(prefix).run(fakeGit(() => ({ stdout })));
}

describe("UncommittedFiles", () => {
  it("lists tracked and untracked files", async () => {
    expect(await listed("", " M a.txt\0?? b.txt\0")).toEqual([
      { path: "a.txt", untracked: false },
      { path: "b.txt", untracked: true },
    ]);
  });

  it("names paths relative to the directory", async () => {
    expect(await listed("apps/web/", " M apps/web/a.txt\0")).toEqual([
      { path: "a.txt", untracked: false },
    ]);
  });

  it.each(["R  new\0old\0", " R new\0old\0", "C  new\0old\0"])(
    "skips where %j came from",
    async (stdout) => {
      expect(await listed("", stdout)).toEqual([{ path: "new", untracked: false }]);
    },
  );

  it("lists nothing in a clean directory", async () => {
    expect(await listed("", "")).toEqual([]);
  });
});

describe("UncommittedFiles outside the directory", () => {
  it("keeps a path that does not start with the directory as git gave it", async () => {
    expect(await listed("apps/web/", " M other/a.txt\0")).toEqual([
      { path: "other/a.txt", untracked: false },
    ]);
  });
});
