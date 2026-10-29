import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { DiffFilesSince } from "../../../../../src/lib/git/operations/diff-files-since";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

/** What files `git diff --raw -z --patch` printing `list` and then `patch` comes to. */
function filesFrom(list: string[], patch: string) {
  const output = list.length === 0 ? "" : `${list.join("\0")}\0\0${patch}`;
  return new DiffFilesSince(SHA, ["."]).run(fakeGit(() => ({ stdout: output })));
}

describe("DiffFilesSince", () => {
  it("is checked for the commit being here", () => {
    expect(new DiffFilesSince(SHA, ["."]).checks()).toEqual([new CommitIsHere(SHA)]);
  });

  it("is null when refused", () => {
    expect(new DiffFilesSince(SHA, ["."]).refused()).toBeNull();
  });

  it("asks git for the list of files ahead of an uncoloured patch", async () => {
    const calls: string[][] = [];

    await new DiffFilesSince(SHA, ["."]).run(
      fakeGit((args) => {
        calls.push([...args]);
        return {};
      }),
    );

    expect(calls.find((args) => args[0] === "diff")).toEqual([
      "diff",
      "--no-ext-diff",
      "--relative",
      "--no-color",
      "--raw",
      "-z",
      "--patch",
      SHA,
      "--",
      ".",
    ]);
  });

  it("pairs each listed file with its section of the patch", async () => {
    const files = await filesFrom(
      [":100644 100644 1 2 M", "a", ":000000 100644 0 2 A", "b"],
      "diff --git a/a b/a\n-x\ndiff --git a/b b/b\n+y\n",
    );

    expect(files).toEqual([
      { path: "a", status: "modified", patch: "diff --git a/a b/a\n-x\n" },
      { path: "b", status: "added", patch: "diff --git a/b b/b\n+y\n" },
    ]);
  });

  it("joins the two sections of a file whose type changed", async () => {
    const files = await filesFrom(
      [":100644 120000 1 2 T", "a", ":100644 100644 1 2 M", "b"],
      "diff --git a/a b/a\n-x\ndiff --git a/a b/a\n+y\ndiff --git a/b b/b\n+z\n",
    );

    expect(files.map((file) => file.patch)).toEqual([
      "diff --git a/a b/a\n-x\ndiff --git a/a b/a\n+y\n",
      "diff --git a/b b/b\n+z\n",
    ]);
  });

  it("lists nothing when nothing changed", async () => {
    expect(await filesFrom([], "")).toEqual([]);
  });
});
