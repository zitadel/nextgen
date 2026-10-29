import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { DiffFilesSince } from "../../../../../src/lib/git/operations/diff-files-since";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

const NONE = (): boolean => false;

/** A git that lists `listed` as changed and answers each file's diff with `patch <path>`; `calls` collects every call. */
function gitListing(listed: string, calls: string[][] = [], existing: string[] = []) {
  return fakeGit((args) => {
    calls.push([...args]);
    if (args.includes("--name-status")) {
      return { stdout: listed };
    }
    if (args.includes("--intent-to-add")) {
      return { exitCode: 2, stderr: "fatal: cannot mark" };
    }
    if (args[0] === "diff") {
      return { stdout: `patch ${args[args.length - 1]}\n` };
    }
    return {};
  }, existing);
}

describe("DiffFilesSince", () => {
  it("is checked for the commit being here", () => {
    expect(new DiffFilesSince(SHA, ["."], { except: NONE }).checks()).toEqual([
      new CommitIsHere(SHA),
    ]);
  });

  it("is null when refused", () => {
    expect(new DiffFilesSince(SHA, ["."], { except: NONE }).refused()).toBeNull();
  });

  it("gives each changed file its own patch", async () => {
    const files = await new DiffFilesSince(SHA, ["."], { except: NONE }).run(
      gitListing("M\0a\0A\0b\0"),
    );

    expect(files).toEqual([
      { path: "a", status: "modified", patch: "patch a\n" },
      { path: "b", status: "added", patch: "patch b\n" },
    ]);
  });

  it("never diffs a file `except` matches", async () => {
    const calls: string[][] = [];

    await new DiffFilesSince(SHA, ["."], { except: (path) => path === ".env" }).run(
      gitListing("M\0a\0M\0.env\0", calls),
    );

    expect(calls.filter((args) => args.includes(".env"))).toEqual([]);
  });

  it.each([
    [true, "--color=always"],
    [false, "--no-color"],
    [undefined, "--no-color"],
  ])("with colour %s diffs with %s", async (color, flag) => {
    const calls: string[][] = [];

    await new DiffFilesSince(SHA, ["."], { except: NONE, color }).run(gitListing("M\0a\0", calls));

    expect(calls.find((args) => args.at(-1) === "a")).toContain(flag);
  });

  it("diffs every file of a long list, in order", async () => {
    const names = Array.from({ length: 40 }, (_, index) => `f${index}`);

    const files = await new DiffFilesSince(SHA, ["."], { except: NONE }).run(
      gitListing(names.map((name) => `M\0${name}\0`).join("")),
    );

    expect(files.map((file) => file.path)).toEqual(names);
  });

  it("still diffs plainly when untracked files cannot be marked as added", async () => {
    const files = await new DiffFilesSince(SHA, ["new.json"], { except: NONE }).run(
      gitListing("M\0a\0", [], ["new.json"]),
    );

    expect(files).toEqual([{ path: "a", status: "modified", patch: "patch a\n" }]);
  });
});
