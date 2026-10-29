import { utimes, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Repository } from "../../../../src/lib/git";
import {
  GitScratch,
  commitAll as commitEverything,
  git,
  headChanges,
  isolateGit,
  stagedFiles,
  treeFiles,
  write,
} from "../../../helpers/git-repo";

const scratch = new GitScratch();

beforeEach(isolateGit);

afterEach(async () => {
  vi.unstubAllEnvs();
  await scratch.cleanup();
});

/** Opens `dir`, failing the test when it is in no repository. */
async function open(dir: string): Promise<Repository> {
  const repository = await Repository.open(dir);
  if (repository === null) {
    throw new Error(`${dir} is in no repository`);
  }
  return repository;
}

/** Leaves nothing out. */
const NONE = (): boolean => false;

const OPTIONS = {
  except: (path: string) => path.endsWith(".env"),
  authorIfGitHasNone: { name: "Fallback", email: "fallback@example.com" },
};

/** A repository with two commits on one branch. */
async function twoCommits(): Promise<string> {
  const cwd = await scratch.committed({ "a.txt": "a\n" });
  await write(cwd, { "b.txt": "b\n" });
  await commitEverything(cwd, "second");
  return cwd;
}

/** A repository with `.zitadel/schemas/a.json` committed, and that commit. */
async function base(): Promise<{ cwd: string; sha: string }> {
  const cwd = await scratch.committed({ ".zitadel/schemas/a.json": "{}\n", "README.md": "r\n" });
  return { cwd, sha: (await git(cwd, "rev-parse", "HEAD")).trim() };
}

describe("Repository.open", () => {
  it("is null outside any repository", async () => {
    expect(await Repository.open(await scratch.directory())).toBeNull();
  });

  it("is null for a directory that does not exist yet", async () => {
    expect(await Repository.open(join(await scratch.repository(), "new-app"))).toBeNull();
  });

  it("is null when there is no git at all", async () => {
    const cwd = await scratch.repository();
    vi.stubEnv("PATH", await scratch.directory());

    expect(await Repository.open(cwd)).toBeNull();
  });

  it("opens the repository a subdirectory is in", async () => {
    const root = await scratch.repository();
    await mkdir(join(root, "apps/web"), { recursive: true });

    expect(await Repository.open(join(root, "apps/web"))).not.toBeNull();
  });

  it("throws when git fails, rather than answering no repository", async () => {
    const cwd = await scratch.repository();
    vi.stubEnv("PATH", await scratch.brokenGit());

    await expect(Repository.open(cwd)).rejects.toThrow("git: not available");
  });

  it("throws when git refuses the repository, rather than answering no repository", async () => {
    const cwd = await scratch.repository();
    vi.stubEnv("PATH", await scratch.brokenGit("fatal: detected dubious ownership", 128));

    await expect(Repository.open(cwd)).rejects.toThrow("fatal: detected dubious ownership");
  });
});

describe("Repository.create", () => {
  it("creates a repository", async () => {
    const cwd = await scratch.directory();

    await Repository.create(cwd);

    expect(await Repository.open(cwd)).not.toBeNull();
  });
});

describe("Repository.currentCommit", () => {
  it("is the commit it is at", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    expect(await (await open(cwd)).currentCommit()).toBe(
      (await git(cwd, "rev-parse", "HEAD")).trim(),
    );
  });

  it("is null before the first commit", async () => {
    expect(await (await open(await scratch.repository())).currentCommit()).toBeNull();
  });
});

describe("Repository.isDirty", () => {
  it("is false for a clean tree", async () => {
    expect(await (await open(await scratch.committed({ "a.txt": "a\n" }))).isDirty()).toBe(false);
  });

  it("is true for a change anywhere in the repository, not only the directory", async () => {
    const root = await scratch.committed({ "apps/web/a.txt": "a\n", "apps/api/b.txt": "b\n" });
    await write(root, { "apps/api/b.txt": "edited\n" });

    expect(await (await open(join(root, "apps/web"))).isDirty()).toBe(true);
  });
});

describe("Repository.uncommittedFiles", () => {
  it("names files relative to the directory, untracked ones included", async () => {
    const root = await scratch.committed({ "apps/web/a.txt": "a\n" });
    await write(root, { "apps/web/a.txt": "edited\n", "apps/web/b.txt": "b\n" });

    expect(await (await open(join(root, "apps/web"))).uncommittedFiles()).toEqual([
      { path: "a.txt", untracked: false },
      { path: "b.txt", untracked: true },
    ]);
  });

  it("leaves out a sibling package's work", async () => {
    const root = await scratch.committed({ "apps/web/a.txt": "a\n", "apps/api/b.txt": "b\n" });
    await writeFile(join(root, "apps/api/b.txt"), "edited\n");

    expect(await (await open(join(root, "apps/web"))).uncommittedFiles()).toEqual([]);
  });

  it("names each file of a directory git has never seen", async () => {
    const root = await scratch.committed({ "README.md": "r\n" });
    await write(root, { "apps/new/a.txt": "a\n" });

    expect(await (await open(join(root, "apps/new"))).uncommittedFiles()).toEqual([
      { path: "a.txt", untracked: true },
    ]);
  });
});

describe("Repository.commitAll", () => {
  it("commits everything under the directory", async () => {
    const cwd = await scratch.committed({ "README.md": "r\n" });
    await write(cwd, { "a.txt": "a\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: true });
  });

  it("leaves out what `except` matches", async () => {
    const cwd = await scratch.committed({ "README.md": "r\n" });
    await write(cwd, { "a.txt": "a\n", ".env": "S=1\n" });

    await (await open(cwd)).commitAll("m", OPTIONS);

    expect(await treeFiles(cwd)).toEqual(["README.md", "a.txt"]);
  });

  it("commits only the directory, not a sibling package", async () => {
    const root = await scratch.committed({ "README.md": "r\n" });
    await write(root, { "apps/web/a.txt": "a\n", "apps/api/b.txt": "b\n" });

    await (await open(join(root, "apps/web"))).commitAll("m", OPTIONS);

    expect(await headChanges(root)).toEqual(["apps/web/a.txt"]);
  });

  it("leaves out what `except` matches in a subdirectory", async () => {
    const root = await scratch.committed({ "README.md": "r\n" });
    await write(root, { "apps/web/a.txt": "a\n", "apps/web/.env": "S=1\n" });

    await (await open(join(root, "apps/web"))).commitAll("m", OPTIONS);

    expect(await treeFiles(root)).toEqual(["README.md", "apps/web/a.txt"]);
  });

  it("leaves a sibling package's staged work staged", async () => {
    const root = await scratch.committed({ "README.md": "r\n" });
    await write(root, { "apps/web/a.txt": "a\n", "apps/api/b.txt": "b\n" });
    await git(root, "add", "apps/api/b.txt");

    await (await open(join(root, "apps/web"))).commitAll("m", OPTIONS);

    expect(await stagedFiles(root)).toEqual(["apps/api/b.txt"]);
  });

  it.each([
    ["HEAD is detached", "HEAD is detached, so the commit would be on no branch"],
    ["a rebase is under way", "a rebase is in progress"],
  ])("commits nothing when %s, and says why", async (_, reason) => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });
    await commitEverything(cwd, "second");
    if (reason.startsWith("HEAD")) {
      await git(cwd, "checkout", "--quiet", "--detach");
    } else {
      await git(cwd, "-c", "sequence.editor=sed -i.bak s/^pick/edit/", "rebase", "-i", "HEAD~1");
    }
    await write(cwd, { "c.txt": "c\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toEqual({ committed: false, reason });
  });

  it("commits nothing when only excluded files changed", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { ".env": "S=1\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toEqual({
      committed: false,
      reason: "there was nothing to commit",
    });
  });

  it("names the developer as author when git knows them", async () => {
    const cwd = await scratch.repository();
    await git(cwd, "config", "user.name", "Dev");
    await git(cwd, "config", "user.email", "dev@example.com");
    await write(cwd, { "a.txt": "a\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ author: "yours" });
  });

  it("names the fallback only where git has no identity at all", async () => {
    const cwd = await scratch.repository();
    await write(cwd, { "a.txt": "a\n" });
    vi.stubEnv("GIT_AUTHOR_NAME", "");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "");

    await (await open(cwd)).commitAll("m", OPTIONS);

    expect((await git(cwd, "log", "-1", "--format=%an <%ae>")).trim()).toBe(
      "Fallback <fallback@example.com>",
    );
  });
});

describe("Repository.commitAll in a busy repository", () => {
  it("commits nothing when a merge is in progress, and says why", async () => {
    const cwd = await twoCommits();
    const branch = (await git(cwd, "symbolic-ref", "--short", "HEAD")).trim();
    await git(cwd, "checkout", "--quiet", "-b", "side", "HEAD~1");
    await write(cwd, { "c.txt": "c\n" });
    await commitEverything(cwd, "side");
    await git(cwd, "merge", "--no-commit", "--no-ff", "--quiet", branch);

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toEqual({
      committed: false,
      reason: "a merge is in progress",
    });
  });

  it("commits nothing when a bisect is in progress, and says why", async () => {
    const cwd = await twoCommits();
    await git(cwd, "bisect", "start");
    await write(cwd, { "c.txt": "c\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toEqual({
      committed: false,
      reason: "a bisect is in progress",
    });
  });

  it("commits on a branch with no commit yet, which is not detached", async () => {
    const cwd = await scratch.repository();
    await write(cwd, { "a.txt": "a\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: true });
  });
});

describe("Repository.diffSince", () => {
  it("shows an untracked file as added", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/b.json": "{}\n" });

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], { except: NONE })).toContain(
      "new file mode",
    );
  });

  it("leaves the developer's index as it was", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/b.json": "{}\n" });

    await (await open(cwd)).diffSince(sha, [".zitadel/"], { except: NONE });

    expect(await stagedFiles(cwd)).toEqual([]);
  });

  it("never shows a file `except` matches, not even its content", async () => {
    const { cwd, sha } = await base();
    await write(cwd, {
      ".zitadel/schemas/b.json": "{}\n",
      ".zitadel/idps/.env": "TOKEN=hunter2\n",
    });

    const diff = await (await open(cwd)).diffSince(sha, [".zitadel/"], {
      except: (path) => path.endsWith(".env"),
    });

    expect(diff).not.toContain("hunter2");
  });

  it("sees an edit made in the same instant the index was written", async () => {
    const { cwd, sha } = await base();
    const file = join(cwd, ".zitadel/schemas/a.json");
    const instant = new Date("2026-01-01T00:00:00Z");
    await utimes(file, instant, instant);
    await git(cwd, "add", ".zitadel/schemas/a.json");
    await utimes(join(cwd, ".git", "index"), instant, instant);
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });
    await utimes(file, instant, instant);

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], { except: NONE })).toContain(
      "+[]",
    );
  });

  it("keeps a rename whole when a secret beside it is left out", async () => {
    const { cwd, sha } = await base();
    await git(cwd, "mv", ".zitadel/schemas/a.json", ".zitadel/schemas/b.json");
    await write(cwd, { ".zitadel/idps/.env": "TOKEN=hunter2\n" });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"], {
      except: (path) => path.endsWith(".env"),
    });

    expect(files?.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: ".zitadel/schemas/b.json", status: "renamed" },
    ]);
  });

  it("still shows a new file as added beside an ignored path", async () => {
    const { cwd, sha } = await base();
    await write(cwd, {
      ".gitignore": "dist/\n",
      "dist/logo.png": "x\n",
      ".zitadel/schemas/new.json": "{}\n",
    });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/", "dist/logo.png"], {
      except: NONE,
    });

    expect(files?.map(({ path, status }) => ({ path, status }))).toContainEqual({
      path: ".zitadel/schemas/new.json",
      status: "added",
    });
  });

  it("still shows the tracked changes when an untracked path cannot be marked", async () => {
    const { cwd, sha } = await base();
    await write(cwd, {
      ".gitignore": "tpl/\n",
      "tpl/ignored.liquid": "x\n",
      ".zitadel/schemas/a.json": "[]\n",
    });

    expect(
      await (await open(cwd)).diffSince(sha, [".zitadel/", "tpl/ignored.liquid"], { except: NONE }),
    ).toContain("+[]");
  });

  it("is null for a commit not in local history", async () => {
    const { cwd } = await base();

    expect(
      await (await open(cwd)).diffSince("0".repeat(40), [".zitadel/"], { except: NONE }),
    ).toBeNull();
  });

  it("is null for an id that is not an object id", async () => {
    const { cwd } = await base();

    expect(
      await (await open(cwd)).diffSince("--output=/tmp/x", [".zitadel/"], { except: NONE }),
    ).toBeNull();
  });
});

describe("Repository.diffFilesSince", () => {
  it("joins back into exactly the uncoloured diff", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n", ".zitadel/flows/b c.json": "{}\n" });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"], { except: NONE });

    expect(files?.map((file) => file.patch).join("")).toBe(
      await (await open(cwd)).diffSince(sha, [".zitadel/"], { except: NONE }),
    );
  });

  it("is null for a commit not in local history", async () => {
    const { cwd } = await base();

    expect(
      await (await open(cwd)).diffFilesSince("0".repeat(40), [".zitadel/"], { except: NONE }),
    ).toBeNull();
  });
});
