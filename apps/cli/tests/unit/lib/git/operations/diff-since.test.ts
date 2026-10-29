import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { DiffSince } from "../../../../../src/lib/git/operations/diff-since";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

/** A git that answers a diff with `diff`, refuses to mark untracked files when `marking` fails, and records each call in `calls`. */
function gitDiffing(diff: string, calls: string[][] = [], marking = true) {
  return fakeGit(
    (args) => {
      calls.push([...args]);
      if (args.includes("--intent-to-add") && !marking) {
        return { exitCode: 128, stderr: "fatal: cannot mark" };
      }
      if (args[0] === "diff") {
        return { stdout: diff };
      }
      return {};
    },
    ["new.json"],
  );
}

describe("DiffSince", () => {
  it("is checked for the commit being here", () => {
    expect(new DiffSince(SHA, ["."], {}).checks()).toEqual([new CommitIsHere(SHA)]);
  });

  it("is null when refused", () => {
    expect(new DiffSince(SHA, ["."], {}).refused()).toBeNull();
  });

  it("gives what git printed", async () => {
    expect(await new DiffSince(SHA, ["."], {}).run(gitDiffing("the diff"))).toBe("the diff");
  });

  it("marks untracked files under its paths as added first", async () => {
    const calls: string[][] = [];

    await new DiffSince(SHA, ["new.json"], {}).run(gitDiffing("", calls));

    expect(calls).toContainEqual(["add", "--intent-to-add", "--", "new.json"]);
  });

  it("still diffs plainly when untracked files cannot be marked as added", async () => {
    expect(await new DiffSince(SHA, ["new.json"], {}).run(gitDiffing("plain", [], false))).toBe(
      "plain",
    );
  });

  it.each([
    [{ color: true }, "--color=always"],
    [{ color: false }, "--no-color"],
    [{}, "--no-color"],
  ])("with %j diffs with %s", async (options, flag) => {
    const calls: string[][] = [];

    await new DiffSince(SHA, ["."], options).run(gitDiffing("", calls));

    expect(calls.find((args) => args[0] === "diff")).toEqual([
      "diff",
      "--no-ext-diff",
      "--relative",
      flag,
      SHA,
      "--",
      ".",
    ]);
  });

  it("adds `extra` to git's format", async () => {
    const calls: string[][] = [];

    await new DiffSince(SHA, ["."], {}, ["--raw"]).run(gitDiffing("", calls));

    expect(calls.find((args) => args[0] === "diff")).toContain("--raw");
  });
});
