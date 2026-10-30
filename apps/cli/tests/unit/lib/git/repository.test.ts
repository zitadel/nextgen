import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
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

const OPTIONS = {
  except: (path: string) => path.endsWith(".env"),
  authorIfGitHasNone: { name: "Fallback", email: "fallback@example.com" },
};

/** A `git` on PATH that starts a repository and then fails, as a full disk would. Returns its directory. */
async function gitThatFailsHalfwayThroughInit(): Promise<string> {
  return fakeGitRunning("/bin/mkdir -p .git/objects");
}

/** {@link gitThatFailsHalfwayThroughInit}, leaving a `.git` nobody may read, so it cannot be removed. */
async function gitThatLeavesAnUnremovableRepository(): Promise<string> {
  return fakeGitRunning("/bin/mkdir -p .git/objects && /bin/chmod 000 .git");
}

/** A `git` on PATH that runs `script`, then fails with "could not write config". Returns its directory. */
async function fakeGitRunning(script: string): Promise<string> {
  const bin = await scratch.directory();
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh\n${script}\necho 'fatal: could not write config' >&2\nexit 1\n`,
  );
  await chmod(join(bin, "git"), 0o755);
  return bin;
}

/** A repository with a merge in progress, its changes all at the root, and an empty `apps/web` beside them. */
async function aMergeUnderWay(): Promise<string> {
  const cwd = await twoCommits();
  const branch = (await git(cwd, "symbolic-ref", "--short", "HEAD")).trim();
  await git(cwd, "checkout", "--quiet", "-b", "side", "HEAD~1");
  await write(cwd, { "c.txt": "c\n" });
  await commitEverything(cwd, "side");
  await git(cwd, "merge", "--no-commit", "--no-ff", "--quiet", branch);
  await mkdir(join(cwd, "apps/web"), { recursive: true });
  return cwd;
}

/** A symlink to `target`, at a different depth from it. */
async function aLinkTo(target: string): Promise<string> {
  const link = join(await scratch.directory(), "web");
  await symlink(target, link);
  return link;
}

/** How many `diff --git` sections `patch` holds. */
function sectionsOf(patch: string): number {
  return patch.split("diff --git").length - 1;
}

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

  it("recognises no repository whatever the developer's locale", async () => {
    const bin = await scratch.directory();
    await writeFile(
      join(bin, "git"),
      '#!/bin/sh\nif [ "$LC_ALL" = C ]; then echo "fatal: not a git repository" >&2; else echo "fatal: kein Git-Repository" >&2; fi\nexit 128\n',
    );
    await chmod(join(bin, "git"), 0o755);
    vi.stubEnv("LC_ALL", "de_DE.UTF-8");
    vi.stubEnv("PATH", bin);

    expect(await Repository.open(await scratch.directory())).toBeNull();
  });

  it("throws when git refuses the repository, rather than answering no repository", async () => {
    const cwd = await scratch.repository();
    const refusal =
      "fatal: detected dubious ownership\nTo add an exception: git config --global --add safe.directory /x";
    vi.stubEnv("PATH", await scratch.brokenGit(refusal, 128));

    await expect(Repository.open(cwd)).rejects.toThrow(refusal);
  });
});

describe("Repository.answer", () => {
  it("gives what the question answers", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    expect(await Repository.answer(cwd, (repository) => repository.currentCommit(), "none")).toBe(
      (await git(cwd, "rev-parse", "HEAD")).trim(),
    );
  });

  it("gives the default outside any repository", async () => {
    const cwd = await scratch.directory();

    expect(await Repository.answer(cwd, (repository) => repository.isDirty(), null)).toBeNull();
  });

  it("gives the default when git fails", async () => {
    const cwd = await scratch.repository();
    vi.stubEnv("PATH", await scratch.brokenGit("fatal: refused", 128));

    expect(await Repository.answer(cwd, (repository) => repository.isDirty(), null)).toBeNull();
  });

  it("gives the default when the question fails", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    expect(await Repository.answer(cwd, () => Promise.reject(new Error("failed")), "none")).toBe(
      "none",
    );
  });
});

describe("Repository.create", () => {
  it("creates a repository", async () => {
    const cwd = await scratch.directory();

    await Repository.create(cwd);

    expect(await Repository.open(cwd)).not.toBeNull();
  });

  it("keeps a .git symlink to something missing when git init fails", async () => {
    const cwd = await scratch.directory();
    await symlink(join(cwd, "missing"), join(cwd, ".git"));
    vi.stubEnv("PATH", await gitThatFailsHalfwayThroughInit());

    await Repository.create(cwd).catch(() => undefined);

    expect((await lstat(join(cwd, ".git"))).isSymbolicLink()).toBe(true);
  });

  it("leaves no half-made repository behind when git init fails", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await gitThatFailsHalfwayThroughInit());

    await Repository.create(cwd).catch(() => undefined);

    expect(existsSync(join(cwd, ".git"))).toBe(false);
  });

  it("keeps a .git that was there before when git init fails", async () => {
    const cwd = await scratch.directory();
    await mkdir(join(cwd, ".git"));
    vi.stubEnv("PATH", await gitThatFailsHalfwayThroughInit());

    await Repository.create(cwd).catch(() => undefined);

    expect(existsSync(join(cwd, ".git"))).toBe(true);
  });

  it("throws git's message when git init fails", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await gitThatFailsHalfwayThroughInit());

    await expect(Repository.create(cwd)).rejects.toThrow("fatal: could not write config");
  });

  it.skipIf(process.getuid?.() === 0)(
    "throws git's message even when the half-made repository cannot be removed (not as root, who can remove it)",
    async () => {
      const cwd = await scratch.directory();
      vi.stubEnv("PATH", await gitThatLeavesAnUnremovableRepository());
      try {
        await expect(Repository.create(cwd)).rejects.toThrow("fatal: could not write config");
      } finally {
        await chmod(join(cwd, ".git"), 0o755);
      }
    },
  );
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

  it("commits with the message it is given", async () => {
    const cwd = await scratch.committed({ "README.md": "r\n" });
    await write(cwd, { "a.txt": "a\n" });

    await (await open(cwd)).commitAll("add a", OPTIONS);

    expect((await git(cwd, "log", "-1", "--format=%s")).trim()).toBe("add a");
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

  it("commits nothing when HEAD is detached", async () => {
    const cwd = await twoCommits();
    await git(cwd, "checkout", "--quiet", "--detach");
    await write(cwd, { "c.txt": "c\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
  });

  it("commits nothing when a rebase is under way", async () => {
    const cwd = await twoCommits();
    await git(cwd, "-c", "sequence.editor=sed -i.bak s/^pick/edit/", "rebase", "-i", "HEAD~1");
    await write(cwd, { "c.txt": "c\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
  });

  it("commits nothing when only excluded files changed", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { ".env": "S=1\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
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

    const outcome = await (await open(cwd)).commitAll("m", OPTIONS);

    expect({
      outcome,
      author: (await git(cwd, "log", "-1", "--format=%an <%ae>")).trim(),
    }).toMatchObject({
      outcome: { author: "fallback" },
      author: "Fallback <fallback@example.com>",
    });
  });
});

describe("Repository.readyToCommit", () => {
  it("is null on a branch with nothing under way", async () => {
    expect(await (await open(await twoCommits())).readyToCommit()).toBeNull();
  });

  it("names a merge under way", async () => {
    expect(await (await open(await aMergeUnderWay())).readyToCommit()).toBe(
      "a merge is in progress",
    );
  });

  it("names a detached HEAD", async () => {
    const cwd = await twoCommits();
    await git(cwd, "checkout", "--quiet", "--detach");

    expect(await (await open(cwd)).readyToCommit()).toBe(
      "HEAD is detached, so the commit would be on no branch",
    );
  });

  it("sees a merge under way through a symlinked directory", async () => {
    const link = await aLinkTo(join(await aMergeUnderWay(), "apps/web"));

    expect(await (await open(link)).readyToCommit()).toBe("a merge is in progress");
  });
});

describe("Repository.commitAll in a busy repository", () => {
  it("commits nothing when a merge is in progress and the directory is reached through a symlink", async () => {
    const link = await aLinkTo(join(await aMergeUnderWay(), "apps/web"));
    await write(link, { "new.txt": "n\n" });

    expect(await (await open(link)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
  });

  it("commits nothing when a merge is in progress", async () => {
    const cwd = await twoCommits();
    const branch = (await git(cwd, "symbolic-ref", "--short", "HEAD")).trim();
    await git(cwd, "checkout", "--quiet", "-b", "side", "HEAD~1");
    await write(cwd, { "c.txt": "c\n" });
    await commitEverything(cwd, "side");
    await git(cwd, "merge", "--no-commit", "--no-ff", "--quiet", branch);

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
  });

  it("commits nothing when a bisect is in progress", async () => {
    const cwd = await twoCommits();
    await git(cwd, "bisect", "start");
    await write(cwd, { "c.txt": "c\n" });

    expect(await (await open(cwd)).commitAll("m", OPTIONS)).toMatchObject({ committed: false });
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

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).toContain("new file mode");
  });

  it("leaves the developer's index as it was", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/b.json": "{}\n" });

    await (await open(cwd)).diffSince(sha, [".zitadel/"], {});

    expect(await stagedFiles(cwd)).toEqual([]);
  });

  it("sees an edit made in the same instant the index was written, by modification time alone", async () => {
    const { cwd, sha } = await base();
    await git(cwd, "config", "core.checkStat", "minimal");
    const file = join(cwd, ".zitadel/schemas/a.json");
    const instant = new Date("2026-01-01T00:00:00Z");
    await utimes(file, instant, instant);
    await git(cwd, "add", ".zitadel/schemas/a.json");
    await utimes(join(cwd, ".git", "index"), instant, instant);
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });
    await utimes(file, instant, instant);

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).toContain("+[]");
  });

  it("sees an edit to a tracked file `.gitignore` now matches", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".gitignore": "*.json\n" });
    await commitEverything(cwd, "ignore");
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).toContain("+[]");
  });

  it("shows only the given paths, relative to the directory", async () => {
    const root = await scratch.committed({
      "apps/web/.zitadel/schemas/a.json": "{}\n",
      "apps/api/b.json": "{}\n",
    });
    const sha = (await git(root, "rev-parse", "HEAD")).trim();
    await write(root, { "apps/web/.zitadel/schemas/a.json": "[]\n", "apps/api/b.json": "[]\n" });

    const diff = await (await open(join(root, "apps/web"))).diffSince(sha, [".zitadel/"], {});

    expect(diff?.match(/^diff --git .*$/gm)).toEqual([
      "diff --git a/.zitadel/schemas/a.json b/.zitadel/schemas/a.json",
    ]);
  });

  it("uses git's own diff, never an external one", async () => {
    const { cwd, sha } = await base();
    const tool = join(await scratch.directory(), "external");
    await writeFile(tool, "#!/bin/sh\necho EXTERNAL\n");
    await chmod(tool, 0o755);
    await git(cwd, "config", "diff.external", tool);
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).not.toContain("EXTERNAL");
  });

  it("colours the diff when asked", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], { color: true })).toContain(
      "\u001b[",
    );
  });

  it("leaves the diff uncoloured otherwise", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n" });

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).not.toContain("\u001b[");
  });

  it("shows a submodule as the developer configured", async () => {
    const sub = await scratch.committed({ "a.txt": "a\n" });
    const cwd = await scratch.committed({ "README.md": "r\n" });
    await git(
      cwd,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      sub,
      ".zitadel/sub",
    );
    await commitEverything(cwd, "submodule");
    const sha = (await git(cwd, "rev-parse", "HEAD")).trim();
    await write(join(cwd, ".zitadel/sub"), { "c.txt": "c\n" });
    await commitEverything(join(cwd, ".zitadel/sub"), "add c");
    await git(cwd, "config", "diff.submodule", "log");

    expect(await (await open(cwd)).diffSince(sha, [".zitadel/"], {})).toContain("> add c");
  });

  it("still shows a new file as added beside an ignored path", async () => {
    const { cwd, sha } = await base();
    await write(cwd, {
      ".gitignore": "dist/\n",
      "dist/logo.png": "x\n",
      ".zitadel/schemas/new.json": "{}\n",
    });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/", "dist/logo.png"]);

    expect(files?.map(({ path, status }) => ({ path, status }))).toContainEqual({
      path: ".zitadel/schemas/new.json",
      status: "added",
    });
  });

  it("is null for a commit not in local history", async () => {
    const { cwd } = await base();

    expect(await (await open(cwd)).diffSince("0".repeat(40), [".zitadel/"], {})).toBeNull();
  });

  it("diffs a path with glob characters as only itself", async () => {
    const cwd = await scratch.committed({ "app/[id].tsx": "a\n", "app/i.tsx": "i\n" });
    const sha = (await git(cwd, "rev-parse", "HEAD")).trim();
    await write(cwd, { "app/[id].tsx": "b\n", "app/i.tsx": "j\n" });

    const diff = await (await open(cwd)).diffSince(sha, ["app/[id].tsx"], {});

    expect(diff?.match(/^diff --git .*$/gm)).toEqual(["diff --git a/app/[id].tsx b/app/[id].tsx"]);
  });

  it("is null for an object that is not a commit", async () => {
    const { cwd } = await base();
    const blob = (await git(cwd, "rev-parse", "HEAD:README.md")).trim();

    expect(await (await open(cwd)).diffSince(blob, [".zitadel/"], {})).toBeNull();
  });
});

describe("Repository.diffFilesSince", () => {
  it("joins back into exactly the uncoloured diff", async () => {
    const { cwd, sha } = await base();
    await write(cwd, { ".zitadel/schemas/a.json": "[]\n", ".zitadel/flows/b c.json": "{}\n" });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"]);

    expect(files?.map((file) => file.patch).join("")).toBe(
      await (await open(cwd)).diffSince(sha, [".zitadel/"], {}),
    );
  });

  it("reports a rename with where it came from", async () => {
    const { cwd, sha } = await base();
    await git(cwd, "mv", ".zitadel/schemas/a.json", ".zitadel/schemas/b.json");

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"]);

    expect(files).toMatchObject([
      {
        path: ".zitadel/schemas/b.json",
        status: "renamed",
        previous_path: ".zitadel/schemas/a.json",
        patch: expect.stringContaining("rename from .zitadel/schemas/a.json"),
      },
    ]);
  });

  it("keeps both sections of a file replaced by a symlink in one entry", async () => {
    const { cwd, sha } = await base();
    await rm(join(cwd, ".zitadel/schemas/a.json"));
    await symlink("../../README.md", join(cwd, ".zitadel/schemas/a.json"));

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"]);

    expect(files?.map(({ path, patch }) => ({ path, sections: sectionsOf(patch) }))).toEqual([
      { path: ".zitadel/schemas/a.json", sections: 2 },
    ]);
  });

  it("gives a changed submodule its own section whatever diff.submodule says", async () => {
    const sub = await scratch.committed({ "a.txt": "a\n" });
    const cwd = await scratch.committed({ ".zitadel/branding/a.json": "{}\n" });
    await git(
      cwd,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      sub,
      ".zitadel/branding/b",
    );
    await commitEverything(cwd, "submodule");
    const sha = (await git(cwd, "rev-parse", "HEAD")).trim();
    await write(join(cwd, ".zitadel/branding/b"), { "c.txt": "c\n" });
    await commitEverything(join(cwd, ".zitadel/branding/b"), "c");
    await write(cwd, { ".zitadel/branding/a.json": "[]\n" });
    await git(cwd, "config", "diff.submodule", "log");

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"]);

    expect(files?.map(({ path, patch }) => ({ path, sections: sectionsOf(patch) }))).toEqual([
      { path: ".zitadel/branding/a.json", sections: 1 },
      { path: ".zitadel/branding/b", sections: 1 },
    ]);
  });

  it("gives a file replaced by a directory of the same name only its own deletion", async () => {
    const { cwd, sha } = await base();
    await rm(join(cwd, ".zitadel/schemas/a.json"));
    await write(cwd, { ".zitadel/schemas/a.json/b.json": '{"b":1}\n' });

    const files = await (await open(cwd)).diffFilesSince(sha, [".zitadel/"]);

    expect(files?.map(({ path, patch }) => ({ path, sections: sectionsOf(patch) }))).toEqual([
      { path: ".zitadel/schemas/a.json", sections: 1 },
      { path: ".zitadel/schemas/a.json/b.json", sections: 1 },
    ]);
  });

  it("is empty when nothing changed", async () => {
    const { cwd, sha } = await base();

    expect(await (await open(cwd)).diffFilesSince(sha, [".zitadel/"])).toEqual([]);
  });

  it("is null for a commit not in local history", async () => {
    const { cwd } = await base();

    expect(await (await open(cwd)).diffFilesSince("0".repeat(40), [".zitadel/"])).toBeNull();
  });
});
