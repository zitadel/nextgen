import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertCleanWorktree,
  ensureInitialCommit,
  INITIAL_COMMIT_SUBJECT,
} from "../../../../src/commands/setup/initial-commit";

const run = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory with one file, outside any repository. */
async function aProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-initial-commit-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

/** A project already under version control, with a clean tree. */
async function aRepository(): Promise<string> {
  const dir = await aProject({
    ".gitignore": "node_modules\n",
    "app/layout.tsx": "export default () => null;\n",
  });
  await run("git", ["init", "--quiet"], { cwd: dir });
  await run("git", ["config", "user.name", "Dev"], { cwd: dir });
  await run("git", ["config", "user.email", "dev@example.com"], { cwd: dir });
  await run("git", ["add", "--all"], { cwd: dir });
  await run(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "--message=feat: the developer's own work",
    ],
    {
      cwd: dir,
    },
  );
  return dir;
}

/**
 * A repository whose project lives in a subdirectory, as in a monorepo. Returns
 * the project directory; the repository root is its grandparent.
 */
async function aSubdirectoryProject(): Promise<{ project: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "zitadel-monorepo-"));
  dirs.push(root);
  const project = join(root, "apps/web");
  await mkdir(join(root, "apps/api"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(join(root, ".gitignore"), "node_modules\n");
  await writeFile(join(root, "apps/api/index.js"), "api\n");
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "web" }));
  await writeFile(join(project, ".gitignore"), "node_modules\n");
  await run("git", ["init", "--quiet"], { cwd: root });
  await run("git", ["add", "--all"], { cwd: root });
  await run(
    "git",
    [
      "-c",
      "user.name=Dev",
      "-c",
      "user.email=dev@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "--message=feat: the monorepo",
    ],
    { cwd: root },
  );
  return { project, root };
}

/** The paths the repository in `cwd` has under version control. */
async function trackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", "ls-files", "-z"], { cwd });
  return stdout.split("\0").filter((line) => line !== "");
}

/** The subjects of every commit in `cwd`, newest first. */
async function commitSubjects(cwd: string): Promise<string[]> {
  const { stdout } = await run("git", ["log", "--format=%s"], { cwd });
  return stdout.split("\n").filter((line) => line !== "");
}

/** A `git` on PATH that fails whatever it is asked, standing in for none at all. */
async function aBrokenGit(): Promise<string> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-no-git-"));
  dirs.push(binDir);
  const binPath = join(binDir, "git");
  await writeFile(binPath, "#!/bin/sh\necho 'git: not available' >&2\nexit 1\n");
  await chmod(binPath, 0o755);
  return binDir;
}

describe("ensureInitialCommit", () => {
  describe("in a directory that is not a repository", () => {
    it("creates one with a single commit", async () => {
      const cwd = await aProject();

      const outcome = await ensureInitialCommit(cwd);

      expect(outcome).toMatchObject({
        kind: "created",
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      });
    });

    it("gives the commit a conventional subject and no trailer", async () => {
      const cwd = await aProject();

      await ensureInitialCommit(cwd);

      const { stdout } = await run("git", ["log", "--format=%B", "-1"], { cwd });
      expect(stdout.trim()).toBe(INITIAL_COMMIT_SUBJECT);
    });

    it("tracks the project's files", async () => {
      const cwd = await aProject({ "app/page.tsx": "export default () => null;\n" });

      await ensureInitialCommit(cwd);

      expect(await trackedFiles(cwd)).toContain("app/page.tsx");
    });

    it("respects the .gitignore the scaffold wrote", async () => {
      const cwd = await aProject({
        ".gitignore": "node_modules\n",
        "node_modules/left/index.js": "",
      });

      await ensureInitialCommit(cwd);

      expect(await trackedFiles(cwd)).not.toContain("node_modules/left/index.js");
    });

    it.each([".zitadel/secret", ".env", ".env.local", ".env.development.local"])(
      "never commits %s, whatever .gitignore says",
      async (path) => {
        const cwd = await aProject({ [path]: "a-secret-value\n" });

        await ensureInitialCommit(cwd);

        expect(await trackedFiles(cwd)).not.toContain(path);
      },
    );

    it("commits .env.example, which carries no secret", async () => {
      const cwd = await aProject({ ".env.example": "ZITADEL_URL=\n" });

      await ensureInitialCommit(cwd);

      expect(await trackedFiles(cwd)).toContain(".env.example");
    });

    it("commits where git can build no identity at all, as a bare CI runner cannot", async () => {
      const cwd = await aProject();
      // An empty inherited identity is what a bare runner leaves, and git
      // refuses it outright rather than guessing.
      vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
      vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
      vi.stubEnv("GIT_AUTHOR_NAME", "");
      vi.stubEnv("GIT_AUTHOR_EMAIL", "");
      try {
        const outcome = await ensureInitialCommit(cwd);

        expect(outcome).toMatchObject({ kind: "created", guessedIdentity: true });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("commits even when the machine has no git identity configured", async () => {
      const cwd = await aProject();
      vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
      vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
      for (const name of [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "EMAIL",
      ]) {
        vi.stubEnv(name, undefined as unknown as string);
      }
      try {
        const outcome = await ensureInitialCommit(cwd);

        expect(outcome).toMatchObject({ kind: "created", guessedIdentity: true });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("reports there was nothing to commit when only secrets are there", async () => {
      const dir = await mkdtemp(join(tmpdir(), "zitadel-initial-commit-"));
      dirs.push(dir);
      await writeFile(join(dir, ".env"), "SECRET=1\n");

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toEqual({ kind: "unavailable", reason: "there was nothing to commit" });
    });
  });

  describe("in a directory that is already a repository", () => {
    it("commits into it rather than nesting a new repository", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

      const outcome = await ensureInitialCommit(cwd);

      expect(outcome).toMatchObject({
        kind: "committed",
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        guessedIdentity: false,
      });
    });

    it("adds its commit on top of the developer's history", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

      await ensureInitialCommit(cwd);

      expect(await commitSubjects(cwd)).toEqual([
        INITIAL_COMMIT_SUBJECT,
        "feat: the developer's own work",
      ]);
    });

    it("leaves a sibling package's staged work out of its commit", async () => {
      const { project, root } = await aSubdirectoryProject();
      await writeFile(join(root, "apps/api/index.js"), "mine, half finished\n");
      await run("git", ["add", "--", "apps/api/index.js"], { cwd: root });
      await writeFile(join(project, "index.js"), "export default () => null;\n");

      await ensureInitialCommit(project);

      const { stdout } = await run("git", ["show", "--name-only", "--pretty=format:", "HEAD"], {
        cwd: root,
      });
      expect(stdout).not.toContain("apps/api/index.js");
    });

    it("leaves that sibling's work staged, exactly as it was", async () => {
      const { project, root } = await aSubdirectoryProject();
      await writeFile(join(root, "apps/api/index.js"), "mine, half finished\n");
      await run("git", ["add", "--", "apps/api/index.js"], { cwd: root });
      await writeFile(join(project, "index.js"), "export default () => null;\n");

      await ensureInitialCommit(project);

      const { stdout } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
      expect(stdout).toContain("apps/api/index.js");
    });

    it("keeps a secret the repository already tracks out of the commit", async () => {
      const cwd = await aRepository();
      // Committed before setup ever ran, so .gitignore has no say over it and
      // the commit cannot be built from the working tree.
      await writeFile(join(cwd, ".env.local"), "PUBLIC=1\n");
      await run("git", ["add", "--", ".env.local"], { cwd });
      await run(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "--quiet", "--no-verify", "--message=feat: env"],
        { cwd },
      );
      await writeFile(join(cwd, ".env.local"), "PUBLIC=1\nZITADEL_CLIENT_SECRET=hunter2\n");
      await writeFile(join(cwd, "index.js"), "export default () => null;\n");

      await ensureInitialCommit(cwd);

      const { stdout } = await run("git", ["show", "HEAD:.env.local"], { cwd });
      expect(stdout).not.toContain("hunter2");
    });

    it("leaves a tracked secret's change in the working tree, uncommitted", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, ".env.local"), "PUBLIC=1\n");
      await run("git", ["add", "--", ".env.local"], { cwd });
      await run(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "--quiet", "--no-verify", "--message=feat: env"],
        { cwd },
      );
      await writeFile(join(cwd, ".env.local"), "PUBLIC=1\nZITADEL_CLIENT_SECRET=hunter2\n");
      await writeFile(join(cwd, "index.js"), "export default () => null;\n");

      await ensureInitialCommit(cwd);

      const { stdout } = await run("git", ["status", "--porcelain", "--", ".env.local"], { cwd });
      expect(stdout.trim()).toBe("M .env.local");
    });

    it("keeps a secret out of the commit from a subdirectory of the repository", async () => {
      const { project } = await aSubdirectoryProject();
      await writeFile(join(project, ".env"), "SUPER_SECRET=hunter2\n");

      await ensureInitialCommit(project);

      expect(await trackedFiles(project)).not.toContain(".env");
    });

    it.each([".env", ".env.café", "my app/.env"])(
      "keeps %s out of the commit, whatever git would quote",
      async (name) => {
        const cwd = await aRepository();
        await mkdir(join(cwd, name, ".."), { recursive: true });
        await writeFile(join(cwd, name), "SUPER_SECRET=hunter2\n");
        await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

        await ensureInitialCommit(cwd);

        expect(await trackedFiles(cwd)).not.toContain(name);
      },
    );

    it("authors the commit as the developer, not as the tool", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

      const outcome = await ensureInitialCommit(cwd);

      expect(outcome).toMatchObject({ guessedIdentity: false });
    });

    it("records the developer's configured email on the commit it makes", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

      await ensureInitialCommit(cwd);

      const { stdout } = await run("git", ["log", "--format=%ae", "-1"], { cwd });
      expect(stdout.trim()).toBe("dev@example.com");
    });

    it("keeps a secret out of that commit too", async () => {
      const cwd = await aRepository();
      await writeFile(join(cwd, ".env"), "SECRET=1\n");

      await ensureInitialCommit(cwd);

      expect(await trackedFiles(cwd)).not.toContain(".env");
    });
  });
});

describe("assertCleanWorktree", () => {
  it("allows a directory that is not a repository at all", async () => {
    const cwd = await aProject();

    await expect(assertCleanWorktree(cwd)).resolves.toBeUndefined();
  });

  it("allows a repository with nothing uncommitted", async () => {
    const cwd = await aRepository();

    await expect(assertCleanWorktree(cwd)).resolves.toBeUndefined();
  });

  it("refuses a repository with a modified file", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "app/layout.tsx"), "the developer's unsaved work\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("counts an untracked file as dirty", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("says an untracked file is untracked, not a change", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      message: "The git working tree has 1 untracked file",
    });
  });

  it("counts the two kinds separately", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "app/layout.tsx"), "changed\n");
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      message: "The git working tree has 1 uncommitted change and 1 untracked file",
    });
  });

  it("names the offending paths so they can be acted on", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      details: { modified: [], untracked: ["notes.md"] },
    });
  });

  it("points at --no-git for setting up without touching version control", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      hint: expect.stringContaining("--no-git"),
    });
  });

  it.each([".gitignore", ".zitadel/local/server.log"])(
    "allows %s, which the CLI writes itself",
    async (path) => {
      const cwd = await aRepository();
      await mkdir(join(cwd, path, ".."), { recursive: true });
      await writeFile(join(cwd, path), "written by start\n");

      await expect(assertCleanWorktree(cwd)).resolves.toBeUndefined();
    },
  );

  it("still refuses the developer's own file beside the CLI's", async () => {
    const cwd = await aRepository();
    await writeFile(join(cwd, ".gitignore"), "node_modules\n.zitadel/local/\n");
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      details: { modified: [], untracked: ["notes.md"] },
    });
  });

  it("allows a subdirectory project whose sibling package has uncommitted work", async () => {
    const { project, root } = await aSubdirectoryProject();
    await writeFile(join(root, "apps/api/index.js"), "api, mid-change\n");

    await expect(assertCleanWorktree(project)).resolves.toBeUndefined();
  });

  it("allows a subdirectory project whose own .gitignore the CLI changed", async () => {
    const { project } = await aSubdirectoryProject();
    await writeFile(join(project, ".gitignore"), "node_modules\n.zitadel/local/\n");

    await expect(assertCleanWorktree(project)).resolves.toBeUndefined();
  });

  it("allows a never-seen project directory holding only what start left", async () => {
    const { root } = await aSubdirectoryProject();
    const fresh = join(root, "apps/brand-new");
    await mkdir(join(fresh, ".zitadel/local"), { recursive: true });
    await writeFile(join(fresh, ".gitignore"), "node_modules\n.zitadel/local/\n");
    await writeFile(join(fresh, ".zitadel/local/server.log"), "written by start\n");

    await expect(assertCleanWorktree(fresh)).resolves.toBeUndefined();
  });

  it("refuses an app the developer scaffolded into a never-seen directory", async () => {
    const { root } = await aSubdirectoryProject();
    const fresh = join(root, "apps/brand-new");
    await mkdir(fresh, { recursive: true });
    await writeFile(join(fresh, "package.json"), '{"name":"brand-new"}');
    await writeFile(join(fresh, "index.js"), "export default () => null;\n");

    await expect(assertCleanWorktree(fresh)).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("names those files rather than reporting an empty path", async () => {
    const { root } = await aSubdirectoryProject();
    const fresh = join(root, "apps/brand-new");
    await mkdir(fresh, { recursive: true });
    await writeFile(join(fresh, "package.json"), '{"name":"brand-new"}');
    await writeFile(join(fresh, "index.js"), "export default () => null;\n");

    await expect(assertCleanWorktree(fresh)).rejects.toMatchObject({
      details: { untracked: ["index.js", "package.json"] },
    });
  });

  it("says that committing a scaffolded app first is the expected step", async () => {
    const { root } = await aSubdirectoryProject();
    const fresh = join(root, "apps/brand-new");
    await mkdir(fresh, { recursive: true });
    await writeFile(join(fresh, "package.json"), '{"name":"brand-new"}');

    await expect(assertCleanWorktree(fresh)).rejects.toMatchObject({
      hint: expect.stringContaining("committing it first is the expected step"),
    });
  });

  it("still refuses a subdirectory project with the developer's own work in it", async () => {
    const { project } = await aSubdirectoryProject();
    await writeFile(join(project, "notes.md"), "mine\n");

    await expect(assertCleanWorktree(project)).rejects.toMatchObject({
      details: { untracked: ["notes.md"] },
    });
  });

  it.each(["a b.md", "café.md"])("reports %s unquoted, as git would spell it", async (name) => {
    const cwd = await aRepository();
    await writeFile(join(cwd, name), "mine\n");

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      details: { untracked: [name] },
    });
  });

  it("reads a renamed file as one change, not as a path with an arrow in it", async () => {
    const cwd = await aRepository();
    await run("git", ["mv", "app/layout.tsx", "app/root.tsx"], { cwd });

    await expect(assertCleanWorktree(cwd)).rejects.toMatchObject({
      details: { modified: ["app/root.tsx"] },
    });
  });

  it("ignores what .gitignore excludes", async () => {
    const cwd = await aRepository();
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await writeFile(join(cwd, "node_modules/left.js"), "");

    await expect(assertCleanWorktree(cwd)).resolves.toBeUndefined();
  });
});

describe("ensureInitialCommit when git cannot run", () => {
  describe("with a git that fails whatever it is asked", () => {
    it("reports why instead of failing", async () => {
      const cwd = await aProject();
      const binDir = await aBrokenGit();
      vi.stubEnv("PATH", binDir);
      try {
        const outcome = await ensureInitialCommit(cwd);

        expect(outcome).toEqual({ kind: "unavailable", reason: "git: not available" });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe("ensureInitialCommit when it refuses to commit", () => {
  it("stages nothing, so a later commit cannot pick up what it left", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-initial-commit-"));
    dirs.push(dir);
    await writeFile(join(dir, ".env"), "SUPER_SECRET=1\n");

    const outcome = await ensureInitialCommit(dir);

    expect(outcome.kind).toBe("unavailable");
    const { stdout } = await run("git", ["diff", "--cached", "--name-only"], { cwd: dir });
    expect(stdout.trim()).toBe("");
  });
});

describe("ensureInitialCommit on a detached HEAD", () => {
  it("commits nothing, and says why", async () => {
    const cwd = await aRepository();
    await run("git", ["checkout", "--quiet", "--detach"], { cwd });
    await writeFile(join(cwd, "app/page.tsx"), "export default () => null;\n");

    expect(await ensureInitialCommit(cwd)).toMatchObject({ kind: "unavailable" });
  });
});
