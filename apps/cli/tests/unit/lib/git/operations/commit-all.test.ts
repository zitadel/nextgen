import { describe, expect, it } from "vitest";

import { HeadIsOnABranch } from "../../../../../src/lib/git/checks/head-is-on-a-branch";
import { NoOperationUnderWay } from "../../../../../src/lib/git/checks/no-operation-under-way";
import { CommitAll } from "../../../../../src/lib/git/operations/commit-all";
import { fakeGit } from "../../../../helpers/git-repo";

const OPTIONS = { except: () => false, authorIfGitHasNone: { name: "n", email: "e" } };

/** One git call a {@link repositoryThatCommits} answered: its arguments and the environment it ran with. */
interface Call {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/**
 * A git whose HEAD is `old` until it is asked to commit, with `a.txt` staged.
 * The commit fails with "fatal: commit failed" when `fails`, and moves HEAD to
 * `new` when `lands`; every call is recorded in `calls`.
 */
function repositoryThatCommits(
  { fails, lands }: { fails: boolean; lands: boolean },
  calls: Call[] = [],
) {
  const state = { head: "old" };
  return fakeGit((args, env) => {
    calls.push({ args: [...args], env });
    if (args.includes("HEAD^{commit}")) {
      return { stdout: `${state.head}\n` };
    }
    if (args.includes("--cached")) {
      return { stdout: "a.txt\0" };
    }
    if (args.includes("commit") && args.includes("--no-verify")) {
      if (lands) {
        state.head = "new";
      }
      if (fails) {
        return { exitCode: 1, stderr: "fatal: commit failed" };
      }
    }
    return {};
  });
}

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

  it("reports a commit that landed although git failed afterwards", async () => {
    const git = repositoryThatCommits({ fails: true, lands: true });

    expect(await new CommitAll("m", OPTIONS).run(git)).toMatchObject({
      committed: true,
      sha: "new",
    });
  });

  it("throws git's error when the commit failed and HEAD did not move", async () => {
    const git = repositoryThatCommits({ fails: true, lands: false });

    await expect(new CommitAll("m", OPTIONS).run(git)).rejects.toThrow("fatal: commit failed");
  });

  it("stages and checks in a temporary staging area, never the developer's", async () => {
    const calls: Call[] = [];

    await new CommitAll("m", OPTIONS).run(
      repositoryThatCommits({ fails: false, lands: true }, calls),
    );

    expect(
      calls
        .filter(({ args }) => args.includes("--cached") || args.includes("--all"))
        .every(({ env }) => env.GIT_INDEX_FILE !== undefined),
    ).toBe(true);
  });

  it("brings the developer's own staging area up to the new commit afterwards", async () => {
    const calls: Call[] = [];

    await new CommitAll("m", OPTIONS).run(
      repositoryThatCommits({ fails: false, lands: true }, calls),
    );

    expect(calls.find(({ args }) => args[0] === "reset")?.env.GIT_INDEX_FILE).toBeUndefined();
  });
});
