import { existsSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NothingExcludedIsStaged } from "../../../../src/lib/git/checks/nothing-excluded-is-staged";
import { SomethingIsStaged } from "../../../../src/lib/git/checks/something-is-staged";
import { Git } from "../../../../src/lib/git/git";
import { StagingArea } from "../../../../src/lib/git/staging-area";
import {
  GitScratch,
  git,
  headChanges,
  isolateGit,
  stagedFiles,
  write,
} from "../../../helpers/git-repo";

const scratch = new GitScratch();

beforeEach(isolateGit);

afterEach(async () => {
  vi.unstubAllEnvs();
  await scratch.cleanup();
});

/** What `staging` holds staged against the last commit. */
async function staged(staging: StagingArea): Promise<string[]> {
  return staging.git.stagedFiles();
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "Someone",
  GIT_AUTHOR_EMAIL: "someone@example.com",
  GIT_COMMITTER_NAME: "Someone",
  GIT_COMMITTER_EMAIL: "someone@example.com",
};

/** Where `staging` keeps its index. */
async function indexOf(staging: StagingArea): Promise<string> {
  return (await staging.git.run(["rev-parse", "--git-path", "index"])).text();
}

describe("StagingArea", () => {
  it("matches the last commit once started from it", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      return staged(staging);
    });

    expect(files).toEqual([]);
  });

  it("stages without touching the developer's own staging area", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      return staged(staging);
    });

    expect({ temporary: files, developers: await stagedFiles(cwd) }).toEqual({
      temporary: ["b.txt"],
      developers: [],
    });
  });

  it("takes out what `except` matches", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n", ".env": "S=1\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.unstage((path) => path === ".env");
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("starts from what the developer has staged", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });
    await git(cwd, "add", "b.txt");

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromDevelopers(new Git(cwd));
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("marks only the paths that exist as added", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.markAsAdded(["b.txt", "gone.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual(["a.txt", "b.txt"]);
  });

  it("gives the first problem its checks find", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      return staging.problem([new SomethingIsStaged()]);
    });

    expect(problem).toBe(await new SomethingIsStaged().problem(new Git(cwd)));
  });

  it("commits what is staged", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.commit("add b", IDENTITY);
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });

  it("removes its staging area once the work is done", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const index = await StagingArea.temporary(new Git(cwd), async (staging) => indexOf(staging));

    expect(existsSync(dirname(index))).toBe(false);
  });

  it("removes its staging area when the work throws", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    let index = "";

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      index = await indexOf(staging);
      throw new Error("failed");
    }).catch(() => undefined);

    expect(existsSync(dirname(index))).toBe(false);
  });

  it("starts empty before the first commit", async () => {
    const cwd = await scratch.repository();

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual([]);
  });

  it("starts empty from a developer who has no staging area yet", async () => {
    const cwd = await scratch.repository();

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromDevelopers(new Git(cwd));
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual([]);
  });

  it("leaves everything staged when `except` matches nothing", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n", "c.txt": "c\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.unstage(() => false);
      return staged(staging);
    });

    expect(files).toEqual(["b.txt", "c.txt"]);
  });

  it("marks nothing when no path exists", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.markAsAdded(["gone.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual(["a.txt"]);
  });

  it("still marks the other paths beside an ignored one", async () => {
    const cwd = await scratch.committed({ ".gitignore": "dist/\n" });
    await write(cwd, { "dist/x.txt": "x\n", "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.markAsAdded(["dist/x.txt", "b.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual([".gitignore", "b.txt"]);
  });

  it("finds no problem when every check holds", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      return staging.problem([new NothingExcludedIsStaged(() => false), new SomethingIsStaged()]);
    });

    expect(problem).toBeNull();
  });

  it("gives only the first of several problems", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) =>
      staging.problem([{ problem: async () => "first" }, { problem: async () => "second" }]),
    );

    expect(problem).toBe("first");
  });

  it("commits as the identity it is given", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.commit("add b", IDENTITY);
    });

    expect((await git(cwd, "log", "-1", "--format=%an <%ae>")).trim()).toBe(
      "Someone <someone@example.com>",
    );
  });

  it("marks a file as added without storing its content", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "secret\n" });

    const entry = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.markAsAdded(["b.txt"]);
      return (await staging.git.run(["ls-files", "--stage", "--", "b.txt"])).text();
    });

    expect(entry).toContain("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("commits even when the repository asks for signed commits", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await git(cwd, "config", "commit.gpgsign", "true");
    await git(cwd, "config", "gpg.program", "false");
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.commit("add b", IDENTITY);
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });

  it("commits even when a pre-commit hook would refuse", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    const hooks = await scratch.directory();
    await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    await chmod(join(hooks, "pre-commit"), 0o755);
    await git(cwd, "config", "core.hooksPath", hooks);
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.commit("add b", IDENTITY);
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });
});
