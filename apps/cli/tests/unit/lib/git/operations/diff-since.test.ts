import { describe, expect, it } from "vitest";

import { CommitIsHere } from "../../../../../src/lib/git/checks/commit-is-here";
import { DiffSince } from "../../../../../src/lib/git/operations/diff-since";
import { fakeGit } from "../../../../helpers/git-repo";

const SHA = "a".repeat(40);

const NONE = (): boolean => false;

describe("DiffSince", () => {
  it("is checked for the commit being here", () => {
    expect(new DiffSince(SHA, ["."], { except: NONE }).checks()).toEqual([new CommitIsHere(SHA)]);
  });

  it("is null when refused", () => {
    expect(new DiffSince(SHA, ["."], { except: NONE }).refused()).toBeNull();
  });

  it("joins each file's patch", async () => {
    const git = fakeGit((args) => {
      if (args.includes("--name-status")) {
        return { stdout: "M\0a\0M\0b\0" };
      }
      if (args[0] === "diff") {
        return { stdout: `patch ${args.at(-1)}\n` };
      }
      return {};
    });

    expect(await new DiffSince(SHA, ["."], { except: NONE }).run(git)).toBe("patch a\npatch b\n");
  });
});
