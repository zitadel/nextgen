import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { CommitAll } from "../../../../../src/lib/git/operations/commit-all";
import { fakeGit } from "../../../../helpers/git-repo";

const OPTIONS = { except: () => false, authorIfGitHasNone: { name: "n", email: "e" } };

describe("CommitAll", () => {
  it("is checked for an operation under way and a detached HEAD", () => {
    expect(new CommitAll("m", OPTIONS).checks().map((check) => check.constructor)).toEqual([
      NoOperationUnderWay,
      HeadIsOnABranch,
    ]);
  });

  it("commits nothing when refused, and says why", () => {
    expect(new CommitAll("m", OPTIONS).refused("why")).toEqual({ committed: false, reason: "why" });
  });

  it("throws when the commit left no HEAD behind", async () => {
    const git = fakeGit((args) => {
      if (args.includes("HEAD^{commit}")) {
        return { exitCode: 1 };
      }
      if (args.includes("--cached")) {
        return { stdout: "a.txt\0" };
      }
      return {};
    });

    await expect(new CommitAll("m", OPTIONS).run(git)).rejects.toThrow(
      "the commit left no HEAD to record",
    );
  });

  it("commits nothing when an excluded file is still staged", async () => {
    const calls: string[][] = [];
    const git = fakeGit((args) => {
      calls.push([...args]);
      if (args.includes("--cached")) {
        return { stdout: "a.txt\0.env\0" };
      }
      return {};
    });

    const outcome = await new CommitAll("m", { ...OPTIONS, except: (path) => path === ".env" }).run(
      git,
    );

    expect({ outcome, committed: calls.some((args) => args.includes("commit")) }).toMatchObject({
      outcome: { committed: false },
      committed: false,
    });
  });

  it("still reports the commit when the developer's index cannot be reset afterwards", async () => {
    const git = fakeGit((args) => {
      if (args.includes("--cached")) {
        return { stdout: "a.txt\0" };
      }
      if (args[0] === "reset" && args.includes(".")) {
        return { exitCode: 1 };
      }
      if (args.includes("HEAD^{commit}")) {
        return { stdout: "abc\n" };
      }
      return {};
    });

    expect(await new CommitAll("m", OPTIONS).run(git)).toEqual({
      committed: true,
      sha: "abc",
      author: "yours",
    });
  });

  it("commits with its message", async () => {
    const calls: string[][] = [];
    const git = fakeGit((args) => {
      calls.push([...args]);
      if (args.includes("--cached")) {
        return { stdout: "a.txt\0" };
      }
      if (args.includes("HEAD^{commit}")) {
        return { stdout: "abc\n" };
      }
      return {};
    });

    await new CommitAll("the message", OPTIONS).run(git);

    expect(calls.find((args) => args.includes("commit"))).toContain("--message=the message");
  });
});
