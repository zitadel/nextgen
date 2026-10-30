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
    expect(new DiffSince(SHA, ["."], {}).checks()).toStrictEqual([new CommitIsHere(SHA)]);
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

    expect(calls).toContainEqual(["add", "--intent-to-add", "--", ":(literal)new.json"]);
  });

  it("still diffs plainly when untracked files cannot be marked as added", async () => {
    expect(await new DiffSince(SHA, ["new.json"], {}).run(gitDiffing("plain", [], false))).toBe(
      "plain",
    );
  });

  it.each([
    ["colour", { color: true }, "--color=always"],
    ["no colour", { color: false }, "--no-color"],
    ["nothing about colour", {}, "--no-color"],
  ])("diffs with the right colour flag when asked for %s", async (_, options, flag) => {
    const calls: string[][] = [];

    await new DiffSince(SHA, ["."], options).run(gitDiffing("", calls));

    expect(calls.find((args) => args[0] === "diff")).toEqual([
      "diff",
      "--no-ext-diff",
      "--relative",
      flag,
      SHA,
      "--",
      ":(literal).",
    ]);
  });

  it("adds `extra` to git's format", async () => {
    const calls: string[][] = [];

    await new DiffSince(SHA, ["."], {}, ["--raw"]).run(gitDiffing("", calls));

    expect(calls.find((args) => args[0] === "diff")).toContain("--raw");
  });

  it("marks and diffs in a temporary staging area, never the developer's", async () => {
    const env: NodeJS.ProcessEnv[] = [];
    const git = fakeGit(
      (args, added) => {
        if (args.includes("--intent-to-add") || args[0] === "diff") {
          env.push(added);
        }
        return {};
      },
      ["new.json"],
    );

    await new DiffSince(SHA, ["new.json"], {}).run(git);

    expect(env.map((added) => added.GIT_INDEX_FILE !== undefined)).toEqual([true, true]);
  });

  it("diffs in the developer's staging area when the temporary one cannot be used", async () => {
    const env: NodeJS.ProcessEnv[] = [];
    const git = fakeGit(
      (args, added) => {
        if (args.includes("--intent-to-add")) {
          return { exitCode: 128, stderr: "fatal: cannot mark" };
        }
        if (args[0] === "diff") {
          env.push(added);
        }
        return {};
      },
      ["new.json"],
    );

    await new DiffSince(SHA, ["new.json"], {}).run(git);

    expect(env.at(-1)?.GIT_INDEX_FILE).toBeUndefined();
  });
});
