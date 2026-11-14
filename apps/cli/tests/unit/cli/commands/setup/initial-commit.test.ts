import { chmod } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import {
  ensureInitialCommit,
  INITIAL_COMMIT_SUBJECT,
  unavailableWarning,
} from "@/cli/commands/setup/steps/make-initial-commit";
import { inspectWorktree } from "@/cli/commands/setup/shared";
import { gitReport } from "@/cli/commands/setup/steps/show-result";
import { it } from "@tests/helpers/fixtures";
import {
  commitAll,
  commitSubjects,
  git,
  headChanges,
  stagedFiles,
  trackedFiles,
  write,
} from "@tests/helpers/git-repo";

/**
 * A full commit sha.
 */
const SHA = /^[0-9a-f]{40}$/;

/**
 * The subject of the developer's own commit in {@link aRepository}.
 */
const DEVELOPERS_WORK = "feat: the developer's own work";

/**
 * The email the developer configured in {@link aRepository}.
 */
const DEVELOPERS_EMAIL = "dev@example.com";

/**
 * A page the developer adds to the app.
 */
const PAGE = { "app/page.tsx": "export default () => null;\n" };

/**
 * A sibling package's file in {@link aMonorepo}.
 */
const SIBLING_FILE = "apps/api/index.js";

/**
 * A project directory in {@link aMonorepo} that git has never seen.
 */
const FRESH_PROJECT = "apps/brand-new";

/**
 * The `.gitignore` the CLI leaves once it ignored the local server's files.
 */
const GITIGNORE_WITH_LOCAL = "node_modules\n.zitadel/local/\n";

/**
 * Writes a project into `dir`, outside any repository: a `package.json` and
 * `files`.
 *
 * @param dir - The project directory.
 * @param files - Further files, by path.
 * @returns Nothing; the files are written.
 */
async function aProject(dir: string, files: Record<string, string> = {}): Promise<void> {
  await write(dir, { "package.json": JSON.stringify({ name: "demo" }), ...files });
}

/**
 * Makes `dir` a project already under version control, with a clean tree and
 * the developer's identity configured.
 *
 * @param dir - The project directory.
 * @returns Nothing; the repository is committed.
 */
async function aRepository(dir: string): Promise<void> {
  await aProject(dir, {
    ".gitignore": "node_modules\n",
    "app/layout.tsx": "export default () => null;\n",
  });
  await git(dir, "init", "--quiet");
  await git(dir, "config", "user.name", "Dev");
  await git(dir, "config", "user.email", DEVELOPERS_EMAIL);
  await commitAll(dir, DEVELOPERS_WORK);
}

/**
 * Makes `root` a committed monorepo whose project lives in `apps/web`, beside
 * a sibling package in `apps/api`.
 *
 * @param root - The repository root.
 * @returns The project directory.
 */
async function aMonorepo(root: string): Promise<string> {
  await write(root, {
    ".gitignore": "node_modules\n",
    [SIBLING_FILE]: "api\n",
    "apps/web/package.json": JSON.stringify({ name: "web" }),
    "apps/web/.gitignore": "node_modules\n",
  });
  await git(root, "init", "--quiet");
  await commitAll(root, "feat: the monorepo");
  return join(root, "apps/web");
}

/**
 * Makes `root` a monorepo whose sibling package has half-finished work staged,
 * while the project has a new file to commit.
 *
 * @param root - The repository root.
 * @returns The project directory.
 */
async function aMonorepoWithStagedSiblingWork(root: string): Promise<string> {
  const project = await aMonorepo(root);
  await write(root, { [SIBLING_FILE]: "mine, half finished\n" });
  await git(root, "add", "--", SIBLING_FILE);
  await write(project, { "index.js": "export default () => null;\n" });
  return project;
}

/**
 * Makes `dir` a repository that tracks `.env.local`, committed before setup
 * ever ran, so `.gitignore` has no say over it; the file has since gained a
 * secret, and the project a new file to commit.
 *
 * @param dir - The project directory.
 * @returns Nothing; the repository is arranged.
 */
async function aRepositoryTrackingASecretFile(dir: string): Promise<void> {
  await aRepository(dir);
  await write(dir, { ".env.local": "PUBLIC=1\n" });
  await git(dir, "add", "--", ".env.local");
  await git(dir, "commit", "--quiet", "--no-verify", "--message=feat: env");
  await write(dir, {
    ".env.local": "PUBLIC=1\nZITADEL_CLIENT_SECRET=hunter2\n",
    "index.js": "export default () => null;\n",
  });
}

/**
 * Puts a `git` on `PATH` that prints `stderr` and fails whatever it is asked.
 *
 * @param dir - The directory to put it in.
 * @param stderr - What it prints, as a `printf` format.
 * @returns Nothing; `PATH` is stubbed to `dir`.
 */
async function aGitThatFails(dir: string, stderr: string): Promise<void> {
  await write(dir, { git: `#!/bin/sh\nprintf '${stderr}' >&2\nexit 1\n` });
  await chmod(join(dir, "git"), 0o755);
  vi.stubEnv("PATH", dir);
}

/**
 * Leaves git an empty inherited identity and no configuration, as a bare CI
 * runner does: git refuses an empty identity outright rather than guessing.
 *
 * @returns Nothing; the environment is stubbed.
 */
function withAnEmptyGitIdentity(): void {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
  vi.stubEnv("GIT_AUTHOR_NAME", "");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "");
}

/**
 * Leaves git no identity and no configuration at all.
 *
 * @returns Nothing; the environment is stubbed.
 */
function withNoGitIdentity(): void {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
  vi.stubEnv("GIT_AUTHOR_NAME", undefined);
  vi.stubEnv("GIT_AUTHOR_EMAIL", undefined);
  vi.stubEnv("GIT_COMMITTER_NAME", undefined);
  vi.stubEnv("GIT_COMMITTER_EMAIL", undefined);
  vi.stubEnv("EMAIL", undefined);
}

describe("ensureInitialCommit", () => {
  describe("in a directory that is not a repository", () => {
    it("creates one with a single commit", async ({ dir }) => {
      await aProject(dir);

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ kind: "created", sha: expect.stringMatching(SHA) });
    });

    it("gives the commit a conventional subject and no trailer", async ({ dir }) => {
      await aProject(dir);

      await ensureInitialCommit(dir);

      expect((await git(dir, "log", "--format=%B", "-1")).trim()).toBe(INITIAL_COMMIT_SUBJECT);
    });

    it("tracks the project's files", async ({ dir }) => {
      await aProject(dir, PAGE);

      await ensureInitialCommit(dir);

      expect(await trackedFiles(dir)).toContain("app/page.tsx");
    });

    it("respects the .gitignore the scaffold wrote", async ({ dir }) => {
      await aProject(dir, { ".gitignore": "node_modules\n", "node_modules/left/index.js": "" });

      await ensureInitialCommit(dir);

      expect(await trackedFiles(dir)).not.toContain("node_modules/left/index.js");
    });

    it.for([".zitadel/secret", ".env", ".env.local", ".env.development.local"])(
      "never commits %s, whatever .gitignore says",
      async (path, { dir }) => {
        await aProject(dir, { [path]: "a-secret-value\n" });

        await ensureInitialCommit(dir);

        expect(await trackedFiles(dir)).not.toContain(path);
      },
    );

    it("commits .env.example, which carries no secret", async ({ dir }) => {
      await aProject(dir, { ".env.example": "ZITADEL_URL=\n" });

      await ensureInitialCommit(dir);

      expect(await trackedFiles(dir)).toContain(".env.example");
    });

    it("commits where git can build no identity at all, as a bare CI runner cannot", async ({
      dir,
    }) => {
      await aProject(dir);
      withAnEmptyGitIdentity();

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ kind: "created", guessedIdentity: true });
    });

    it("commits even when the machine has no git identity configured", async ({ dir }) => {
      await aProject(dir);
      withNoGitIdentity();

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ kind: "created", guessedIdentity: true });
    });

    describe("when only secrets are there", () => {
      it("reports there was nothing to commit", async ({ dir }) => {
        await write(dir, { ".env": "SECRET=1\n" });

        const outcome = await ensureInitialCommit(dir);

        expect(outcome).toEqual({
          kind: "unavailable",
          reason: "there was nothing to commit",
          createdRepository: true,
        });
      });

      it("stages nothing, so a later commit cannot pick up what it left", async ({ dir }) => {
        await write(dir, { ".env": "SUPER_SECRET=1\n" });

        await ensureInitialCommit(dir);

        expect(await stagedFiles(dir)).toEqual([]);
      });
    });
  });

  describe("in a directory that is already a repository", () => {
    it("commits into it rather than nesting a new repository", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, PAGE);

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({
        kind: "committed",
        sha: expect.stringMatching(SHA),
        guessedIdentity: false,
      });
    });

    it("adds its commit on top of the developer's history", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, PAGE);

      await ensureInitialCommit(dir);

      expect(await commitSubjects(dir)).toEqual([INITIAL_COMMIT_SUBJECT, DEVELOPERS_WORK]);
    });

    it("authors the commit as the developer, not as the tool", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, PAGE);

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ guessedIdentity: false });
    });

    it("records the developer's configured email on the commit it makes", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, PAGE);

      await ensureInitialCommit(dir);

      expect((await git(dir, "log", "--format=%ae", "-1")).trim()).toBe(DEVELOPERS_EMAIL);
    });

    it("keeps a secret out of that commit too", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { ".env": "SECRET=1\n" });

      await ensureInitialCommit(dir);

      expect(await trackedFiles(dir)).not.toContain(".env");
    });

    it.for([".env", ".env.café", "my app/.env"])(
      "keeps %s out of the commit, whatever git would quote",
      async (name, { dir }) => {
        await aRepository(dir);
        await write(dir, { [name]: "SUPER_SECRET=hunter2\n", ...PAGE });

        await ensureInitialCommit(dir);

        expect(await trackedFiles(dir)).not.toContain(name);
      },
    );

    it("reports that it did not create the repository when the commit fails", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { ".env": "SECRET=1\n" });

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ kind: "unavailable", createdRepository: false });
    });

    describe("that tracks a secret file", () => {
      it("keeps the secret out of the commit", async ({ dir }) => {
        await aRepositoryTrackingASecretFile(dir);

        await ensureInitialCommit(dir);

        expect(await git(dir, "show", "HEAD:.env.local")).not.toContain("hunter2");
      });

      it("leaves the secret's change in the working tree, uncommitted", async ({ dir }) => {
        await aRepositoryTrackingASecretFile(dir);

        await ensureInitialCommit(dir);

        expect((await git(dir, "status", "--porcelain", "--", ".env.local")).trim()).toBe(
          "M .env.local",
        );
      });
    });

    describe("from a subdirectory", () => {
      it("keeps a secret out of the commit", async ({ dir }) => {
        const project = await aMonorepo(dir);
        await write(project, { ".env": "SUPER_SECRET=hunter2\n" });

        await ensureInitialCommit(project);

        expect(await trackedFiles(project)).not.toContain(".env");
      });

      it("leaves a sibling package's staged work out of its commit", async ({ dir }) => {
        const project = await aMonorepoWithStagedSiblingWork(dir);

        await ensureInitialCommit(project);

        expect(await headChanges(dir)).not.toContain(SIBLING_FILE);
      });

      it("leaves that sibling's work staged, exactly as it was", async ({ dir }) => {
        const project = await aMonorepoWithStagedSiblingWork(dir);

        await ensureInitialCommit(project);

        expect(await stagedFiles(dir)).toContain(SIBLING_FILE);
      });
    });
  });

  describe("when git cannot run", () => {
    it("reports why instead of failing", async ({ dir, other }) => {
      await aProject(dir);
      await aGitThatFails(other, "git: not available\\n");

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toEqual({
        kind: "unavailable",
        reason: "git: not available",
        createdRepository: false,
      });
    });

    it("reports only git's first line, for a one-line warning", async ({ dir, other }) => {
      await aProject(dir);
      await aGitThatFails(other, "fatal: one\\nhint: two\\n");

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toEqual({
        kind: "unavailable",
        reason: "fatal: one",
        createdRepository: false,
      });
    });

    it("reports the line that says why, not a warning before it", async ({ dir, other }) => {
      await aProject(dir);
      await aGitThatFails(
        other,
        "warning: LF will be replaced by CRLF\\nfatal: adding files failed\\n",
      );

      const outcome = await ensureInitialCommit(dir);

      expect(outcome).toMatchObject({ reason: "fatal: adding files failed" });
    });
  });
});

describe("inspectWorktree", () => {
  it("allows a directory that is not a repository at all", async ({ dir }) => {
    await aProject(dir);

    const worktree = await inspectWorktree(dir);

    expect(worktree).toMatchObject({ kind: "no-repository" });
  });

  it("allows a repository with nothing uncommitted", async ({ dir }) => {
    await aRepository(dir);

    const worktree = await inspectWorktree(dir);

    expect(worktree).toMatchObject({ kind: "clean" });
  });

  it("ignores what .gitignore excludes", async ({ dir }) => {
    await aRepository(dir);
    await write(dir, { "node_modules/left.js": "" });

    const worktree = await inspectWorktree(dir);

    expect(worktree).toMatchObject({ kind: "clean" });
  });

  it.for([".gitignore", ".zitadel/local/server.log"])(
    "allows %s, which the CLI writes itself",
    async (path, { dir }) => {
      await aRepository(dir);
      await write(dir, { [path]: "written by start\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "clean" });
    },
  );

  describe("with uncommitted work", () => {
    it("refuses a repository with a modified file", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { "app/layout.tsx": "the developer's unsaved work\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty" });
    });

    it("counts an untracked file as dirty", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { "notes.md": "mine\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty" });
    });

    it("names the offending paths so they can be acted on", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { "notes.md": "mine\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty", modified: [], untracked: ["notes.md"] });
    });

    it("still refuses the developer's own file beside the CLI's", async ({ dir }) => {
      await aRepository(dir);
      await write(dir, { ".gitignore": GITIGNORE_WITH_LOCAL, "notes.md": "mine\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty", modified: [], untracked: ["notes.md"] });
    });

    it.for(["a b.md", "café.md"])(
      "reports %s unquoted, as git would spell it",
      async (name, { dir }) => {
        await aRepository(dir);
        await write(dir, { [name]: "mine\n" });

        const worktree = await inspectWorktree(dir);

        expect(worktree).toMatchObject({ kind: "dirty", untracked: [name] });
      },
    );

    it("reads a renamed file as one change, not as a path with an arrow in it", async ({ dir }) => {
      await aRepository(dir);
      await git(dir, "mv", "app/layout.tsx", "app/root.tsx");

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty", modified: ["app/root.tsx"] });
    });

    it("refuses uncommitted work under a directory only named like the local server's", async ({
      dir,
    }) => {
      await aRepository(dir);
      await write(dir, { ".Zitadel/Local/notes.md": "mine\n" });

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "dirty" });
    });
  });

  describe("in a subdirectory project", () => {
    it("allows one whose sibling package has uncommitted work", async ({ dir }) => {
      const project = await aMonorepo(dir);
      await write(dir, { [SIBLING_FILE]: "api, mid-change\n" });

      const worktree = await inspectWorktree(project);

      expect(worktree).toMatchObject({ kind: "clean" });
    });

    it("allows one whose own .gitignore the CLI changed", async ({ dir }) => {
      const project = await aMonorepo(dir);
      await write(project, { ".gitignore": GITIGNORE_WITH_LOCAL });

      const worktree = await inspectWorktree(project);

      expect(worktree).toMatchObject({ kind: "clean" });
    });

    it("still refuses one with the developer's own work in it", async ({ dir }) => {
      const project = await aMonorepo(dir);
      await write(project, { "notes.md": "mine\n" });

      const worktree = await inspectWorktree(project);

      expect(worktree).toMatchObject({ kind: "dirty", untracked: ["notes.md"] });
    });
  });

  describe("in a project directory git has never seen", () => {
    it("allows one holding only what start left", async ({ dir }) => {
      await aMonorepo(dir);
      await write(join(dir, FRESH_PROJECT), {
        ".gitignore": GITIGNORE_WITH_LOCAL,
        ".zitadel/local/server.log": "written by start\n",
      });

      const worktree = await inspectWorktree(join(dir, FRESH_PROJECT));

      expect(worktree).toMatchObject({ kind: "clean" });
    });

    it("refuses an app the developer scaffolded into it", async ({ dir }) => {
      await aMonorepo(dir);
      await write(join(dir, FRESH_PROJECT), {
        "package.json": '{"name":"brand-new"}',
        "index.js": "export default () => null;\n",
      });

      const worktree = await inspectWorktree(join(dir, FRESH_PROJECT));

      expect(worktree).toMatchObject({ kind: "dirty" });
    });

    it("names those files rather than reporting an empty path", async ({ dir }) => {
      await aMonorepo(dir);
      await write(join(dir, FRESH_PROJECT), {
        "package.json": '{"name":"brand-new"}',
        "index.js": "export default () => null;\n",
      });

      const worktree = await inspectWorktree(join(dir, FRESH_PROJECT));

      expect(worktree).toMatchObject({ kind: "dirty", untracked: ["index.js", "package.json"] });
    });

    it("says that committing a scaffolded app first is the expected step", async ({ dir }) => {
      await aMonorepo(dir);
      await write(join(dir, FRESH_PROJECT), { "package.json": '{"name":"brand-new"}' });

      const worktree = await inspectWorktree(join(dir, FRESH_PROJECT));

      expect(worktree).toMatchObject({ kind: "dirty" });
    });
  });

  describe("where a commit would not land on a branch", () => {
    it("refuses a detached HEAD before setup writes anything", async ({ dir }) => {
      await aRepository(dir);
      await git(dir, "checkout", "--quiet", "--detach");

      const worktree = await inspectWorktree(dir);

      expect(worktree).toMatchObject({ kind: "blocked" });
    });

    it("names what stops the commit", async ({ dir }) => {
      await aRepository(dir);
      await git(dir, "checkout", "--quiet", "--detach");

      const worktree = await inspectWorktree(dir);

      expect(worktree).toEqual({
        kind: "blocked",
        blocked: "HEAD is detached, so the commit would be on no branch",
      });
    });
  });
});

describe("gitReport", () => {
  it("reports a repository setup created and committed into", () => {
    const report = gitReport({
      kind: "created",
      sha: "abc",
      guessedIdentity: false,
      invented: false,
    });

    expect(report).toEqual({ initialized: true, commit: "abc" });
  });

  it("reports a commit into a repository that already existed", () => {
    const report = gitReport({
      kind: "committed",
      sha: "abc",
      guessedIdentity: false,
      invented: false,
    });

    expect(report).toEqual({ initialized: false, commit: "abc" });
  });

  it("reports a repository setup created even when its commit failed", () => {
    const report = gitReport({ kind: "unavailable", reason: "r", createdRepository: true });

    expect(report).toEqual({ initialized: true, commit: null });
  });

  it("reports no repository and no commit when the commit failed in an existing one", () => {
    const report = gitReport({ kind: "unavailable", reason: "r", createdRepository: false });

    expect(report).toEqual({ initialized: false, commit: null });
  });

  it("reports nothing when setup skipped git", () => {
    const report = gitReport({ kind: "skipped" });

    expect(report).toEqual({ initialized: false, commit: null });
  });
});

describe("unavailableWarning", () => {
  it("names the reason the commit could not be made", () => {
    const warning = unavailableWarning({ reason: "fatal: one", createdRepository: false });

    expect(warning).toBe(
      "Could not commit the scaffolded project (fatal: one); the first release records no commit, so the next deploy cannot show a diff.",
    );
  });

  it("names a missing reason rather than leaving it blank", () => {
    const warning = unavailableWarning({ reason: "", createdRepository: false });

    expect(warning).toContain("(git gave no reason)");
  });

  it("says when setup left a new, empty repository behind", () => {
    const warning = unavailableWarning({ reason: "fatal: one", createdRepository: true });

    expect(warning).toContain("Setup created a new, empty git repository here.");
  });
});
