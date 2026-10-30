import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

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

const exec = promisify(execFile);

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

const AUTHOR = { name: "Someone", email: "someone@example.com" };

/** What a commit from `cwd` would stage, with `except` left out. */
async function stagedFrom(
  cwd: string,
  except: (path: string) => boolean = () => false,
): Promise<string[]> {
  return StagingArea.temporary(new Git(cwd), async (staging) => {
    await staging.startFromHead(new Git(cwd));
    await staging.addAll(except);
    return staged(staging);
  });
}

/** Whether git's object store holds the content of the file at `path`. */
async function stored(cwd: string, path: string): Promise<boolean> {
  const blob = (await git(cwd, "hash-object", path)).trim();
  return git(cwd, "cat-file", "-e", blob).then(
    () => true,
    () => false,
  );
}

/** Where `staging` keeps its index. */
async function indexOf(staging: StagingArea): Promise<string> {
  return (await staging.git.run(["rev-parse", "--git-path", "index"])).text();
}

describe("StagingArea", () => {
  it("matches the last commit once started from it", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      return staged(staging);
    });

    expect(files).toEqual([]);
  });

  it("stages without touching the developer's own staging area", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
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
      await staging.startFromHead(new Git(cwd));
      await staging.addAll((path) => path === ".env");
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
      await staging.startFromHead(new Git(cwd));
      await staging.markAsAdded(["b.txt", "gone.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual(["a.txt", "b.txt"]);
  });

  it("gives the first problem its checks find", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      return staging.problem([new SomethingIsStaged()]);
    });

    expect(problem).toBe(await new SomethingIsStaged().problem(new Git(cwd)));
  });

  it("commits what is staged", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });

  it("leaves the author to git when given none", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await git(cwd, "config", "user.name", "Dev");
    await git(cwd, "config", "user.email", "dev@example.com");
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", null);
    });

    expect((await git(cwd, "log", "-1", "--format=%an <%ae>")).trim()).toBe(
      "Dev <dev@example.com>",
    );
  });

  it("names its author even over an inherited empty name", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });
    vi.stubEnv("GIT_AUTHOR_NAME", "");

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect((await git(cwd, "log", "-1", "--format=%an <%ae> / %cn <%ce>")).trim()).toBe(
      "Someone <someone@example.com> / Someone <someone@example.com>",
    );
  });

  it("commits with the message it is given", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect((await git(cwd, "log", "-1", "--format=%s")).trim()).toBe("add b");
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
      await staging.startFromHead(new Git(cwd));
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

  it("never writes an excluded file's content to the object store", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n", ".env": "TOKEN=hunter2\n" });
    const blob = (await git(cwd, "hash-object", ".env")).trim();

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll((path) => path === ".env");
    });

    await expect(git(cwd, "cat-file", "-e", blob)).rejects.toThrow();
  });

  it("keeps a tracked excluded file as the last commit has it", async () => {
    const cwd = await scratch.committed({ ".env": "OLD=1\n" });
    await write(cwd, { ".env": "NEW=1\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll((path) => path === ".env");
      return staged(staging);
    });

    expect(files).toEqual([]);
  });

  it("stages a file whose name is not valid UTF-8", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    const blob = (await git(cwd, "hash-object", "-w", "a.txt")).trim();
    await exec(
      "sh",
      ["-c", `git update-index --add --cacheinfo "100644,${blob},$(printf 'caf\\351.txt')"`],
      { cwd },
    );
    await git(cwd, "commit", "--quiet", "--message=latin1");

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      return staged(staging);
    });

    expect(files).toHaveLength(1);
  });

  it("names each file to `except` as UTF-8", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "café.txt": "secret\n", "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll((path) => path === "café.txt");
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("stages a deletion", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n", "b.txt": "b\n" });
    await rm(join(cwd, "b.txt"));

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("marks nothing when no path exists", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.markAsAdded(["gone.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual(["a.txt"]);
  });

  it("still marks the other paths beside an ignored one", async () => {
    const cwd = await scratch.committed({ ".gitignore": "dist/\n" });
    await write(cwd, { "dist/x.txt": "x\n", "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.markAsAdded(["dist/x.txt", "b.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual([".gitignore", "b.txt"]);
  });

  it("finds no problem when every check holds", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
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
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect((await git(cwd, "log", "-1", "--format=%an <%ae>")).trim()).toBe(
      "Someone <someone@example.com>",
    );
  });

  it("marks a file as added without storing its content", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "secret\n" });

    const entry = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
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
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
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
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });

  it.each([["skip-worktree"], ["assume-unchanged"]])(
    "leaves out the local edit of a file the developer marked %s",
    async (flag) => {
      const cwd = await scratch.committed({ "config.json": "KEY=placeholder\n" });
      await git(cwd, "update-index", `--${flag}`, "config.json");
      await write(cwd, { "config.json": "KEY=live\n", "new.txt": "n\n" });

      expect(await stagedFrom(cwd)).toEqual(["new.txt"]);
    },
  );

  it("stages nothing when the only change is to a file the developer marked skip-worktree", async () => {
    const cwd = await scratch.committed({ "config.json": "KEY=placeholder\n" });
    await git(cwd, "update-index", "--skip-worktree", "config.json");
    await write(cwd, { "config.json": "KEY=live\n" });

    expect(await stagedFrom(cwd)).toEqual([]);
  });

  it("never stores the local content of a file the developer marked skip-worktree", async () => {
    const cwd = await scratch.committed({ "config.json": "KEY=placeholder\n" });
    await git(cwd, "update-index", "--skip-worktree", "config.json");
    await write(cwd, { "config.json": "KEY=live\n" });

    await stagedFrom(cwd);

    expect(await stored(cwd, "config.json")).toBe(false);
  });

  it("stages only the checked-out part of a sparse checkout", async () => {
    const cwd = await scratch.committed({ "web/a.txt": "a\n", "other/b.txt": "b\n" });
    await git(cwd, "sparse-checkout", "set", "--cone", "web");
    await write(cwd, { "web/new.txt": "n\n" });

    expect(await stagedFrom(cwd)).toEqual(["web/new.txt"]);
  });

  it("stages a tracked file in a directory .gitignore ignores", async () => {
    const cwd = await scratch.committed({ ".gitignore": "tmp/\n" });
    await write(cwd, { "tmp/kept.txt": "a\n" });
    await git(cwd, "add", "--force", "tmp/kept.txt");
    await git(cwd, "commit", "--quiet", "--message=kept");
    await write(cwd, { "tmp/kept.txt": "b\n" });

    expect(await stagedFrom(cwd)).toEqual(["tmp/kept.txt"]);
  });

  it("never stores an excluded file inside a directory that replaced a file", async () => {
    const cwd = await scratch.committed({ config: "c\n" });
    await rm(join(cwd, "config"));
    await write(cwd, { "config/.env": "SECRET=1\n", "config/x.txt": "x\n" });

    await stagedFrom(cwd, (path) => path.endsWith(".env"));

    expect(await stored(cwd, "config/.env")).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)(
    "gives the work's result even when its staging area cannot be removed (not as root)",
    async () => {
      const cwd = await scratch.committed({ "a.txt": "a\n" });
      const folder = { path: "" };

      try {
        const result = await StagingArea.temporary(new Git(cwd), async (staging) => {
          folder.path = dirname(await indexOf(staging));
          await writeFile(join(folder.path, "held"), "");
          await chmod(folder.path, 0o500);
          return "done";
        });

        expect(result).toBe("done");
      } finally {
        await chmod(folder.path, 0o755);
        await rm(folder.path, { recursive: true, force: true });
      }
    },
  );

  it("runs the commit's hooks with no literal-paths setting of its own", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    const hooks = await scratch.directory();
    const seen = join(hooks, "seen");
    await writeFile(join(hooks, "post-commit"), `#!/bin/sh\nenv > "${seen}"\n`);
    await chmod(join(hooks, "post-commit"), 0o755);
    await git(cwd, "config", "core.hooksPath", hooks);
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead(new Git(cwd));
      await staging.addAll(() => false);
      await staging.commit("add b", AUTHOR);
    });

    expect(await readFile(seen, "utf8")).not.toContain("GIT_LITERAL_PATHSPECS");
  });
});
