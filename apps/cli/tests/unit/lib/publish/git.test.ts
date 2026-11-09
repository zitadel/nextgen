import { rm, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { diffConfigAgainst, diffConfigFilesAgainst, worktreeIsDirty } from "@/lib/publish/git";
import { it } from "@tests/helpers/fixtures";
import { commitAll, git, write } from "@tests/helpers/git-repo";

/**
 * The one configuration file the first commit holds.
 */
const MARKER = ".zitadel/schemas/marker.json";

/**
 * The password policy's file, which a release carries.
 */
const POLICY = ".zitadel/policies/auth.factor.password.set.json";

/**
 * The password policy's test file, which no release carries.
 */
const POLICY_TEST = ".zitadel/policies/auth.factor.password.set.test.json";

/**
 * A commit that is in no repository.
 */
const UNKNOWN_COMMIT = "0".repeat(40);

/**
 * Makes `dir` a repository whose one clean commit holds {@link MARKER} and a README.
 *
 * @param dir - The directory to make a repository of.
 * @returns The commit.
 */
async function aCleanCommit(dir: string): Promise<string> {
  await git(dir, "init", "--quiet");
  await write(dir, { [MARKER]: "{}", "README.md": "# app\n" });
  await commitAll(dir, "initial");
  return headOf(dir);
}

/**
 * The commit HEAD points at.
 *
 * @param dir - The repository.
 * @returns The commit's full id.
 */
async function headOf(dir: string): Promise<string> {
  return (await git(dir, "rev-parse", "HEAD")).trim();
}

/**
 * Rewrites {@link MARKER} with content of the same size, leaving the file and
 * the index with the timestamps they had, so the file's stat matches the index.
 *
 * @remarks
 * Git must compare content for an entry at least as new as the index: an
 * index newer than the file would make the edit look clean.
 *
 * @param dir - The repository.
 * @param content - The new content, as long as the old.
 */
async function editBehindTheIndex(dir: string, content: string): Promise<void> {
  await git(dir, "config", "core.trustctime", "false");
  await git(dir, "config", "core.checkStat", "minimal");
  const file = join(dir, MARKER);
  const mtime = new Date(Date.now() - 10_000);
  await utimes(file, mtime, mtime);
  await git(dir, "update-index", "--refresh");
  await write(dir, { [MARKER]: content });
  await utimes(file, mtime, mtime);
  await utimes(join(dir, ".git", "index"), mtime, mtime);
}

/**
 * The path and status of each file a diff reports.
 *
 * @param files - The files, as the diff reports them.
 * @returns Each file's path and status.
 */
function statusesOf(
  files: readonly { path: string; status: string }[] | null,
): { path: string; status: string }[] | undefined {
  return files?.map(({ path, status }) => {
    return { path, status };
  });
}

describe("worktreeIsDirty", () => {
  it("is false for a clean worktree", async ({ dir }) => {
    await aCleanCommit(dir);

    const dirty = await worktreeIsDirty(dir);

    expect(dirty).toBe(false);
  });

  it("is true for an uncommitted change outside .zitadel/", async ({ dir }) => {
    await aCleanCommit(dir);
    await write(dir, { "README.md": "# app\n\nedited\n" });

    const dirty = await worktreeIsDirty(dir);

    expect(dirty).toBe(true);
  });

  it("is false when there is no git repository", async ({ dir }) => {
    const dirty = await worktreeIsDirty(dir);

    expect(dirty).toBe(false);
  });
});

describe("diffConfigAgainst", () => {
  it("detects a same-size edit whose timestamp matches the index", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await editBehindTheIndex(dir, "[]");

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).toContain("+[]");
  });

  it("shows an untracked .zitadel/ file as an addition", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { ".zitadel/schemas/new.json": '{ "added": true }\n' });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).toContain('+{ "added": true }');
  });

  it("shows a tracked change", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { [MARKER]: '{ "edited": true }\n' });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).toContain(MARKER);
  });

  it("leaves files outside .zitadel/ out", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { [MARKER]: '{ "edited": true }\n', "README.md": "# app\n\nedited\n" });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).not.toContain("README.md");
  });

  it("shows a referenced template the bundle inlines from outside .zitadel/", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { "templates/login.liquid": "<p>edited</p>\n" });

    const diff = await diffConfigAgainst(dir, sha, false, ["templates/login.liquid"]);

    expect(diff).toContain("+<p>edited</p>");
  });

  it("leaves a file outside .zitadel/ out when nothing references it", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { "templates/login.liquid": "<p>edited</p>\n" });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).not.toContain("login.liquid");
  });

  it("never shows .zitadel/secret, which is not part of a release", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { ".zitadel/secret": '{ "project_secret": "sk_live" }\n' });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).not.toContain("sk_live");
  });

  it("shows a policy change, which a release carries", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { [POLICY]: '{ "config": { "min_length": 12 } }\n' });

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).toContain('+{ "config": { "min_length": 12 } }');
  });

  it.for([
    ["the policies' README", { ".zitadel/policies/README.md": "# Policies\n" }],
    [
      "a policies subdirectory",
      { ".zitadel/policies/drafts/a.json": "{}\n", ".zitadel/policies/drafts/a.test.json": "[]\n" },
    ],
    ["a policy test file", { [POLICY_TEST]: "[]\n" }],
  ] as const)("leaves out %s, which no release carries", async ([, files], { dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, files);

    const diff = await diffConfigAgainst(dir, sha, false);

    expect(diff).toBe("");
  });

  it("returns null when the commit is not in this repository's history", async ({ dir }) => {
    await aCleanCommit(dir);

    const diff = await diffConfigAgainst(dir, UNKNOWN_COMMIT, false);

    expect(diff).toBeNull();
  });
});

describe("diffConfigFilesAgainst", () => {
  it("reports a changed file with its part of the diff", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { [MARKER]: '{ "edited": true }\n' });

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(files).toEqual([
      { path: MARKER, status: "modified", patch: expect.stringContaining('+{ "edited": true }') },
    ]);
  });

  it("reports an untracked file as added", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { ".zitadel/schemas/new.json": '{ "added": true }\n' });

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(statusesOf(files)).toEqual([{ path: ".zitadel/schemas/new.json", status: "added" }]);
  });

  it("reports a policy but not its test file, edited or committed", async ({ dir }) => {
    await aCleanCommit(dir);
    await write(dir, { [POLICY]: "{}\n", [POLICY_TEST]: "[]\n" });
    await commitAll(dir, "policies");
    const sha = await headOf(dir);
    await write(dir, { [POLICY]: '{ "edited": true }\n', [POLICY_TEST]: "[1]\n" });

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(statusesOf(files)).toEqual([{ path: POLICY, status: "modified" }]);
  });

  it("reports a policy renamed to or from a test file as the policy it removes or adds", async ({
    dir,
  }) => {
    await aCleanCommit(dir);
    await write(dir, {
      ".zitadel/policies/a.json": '{ "operation": "a" }\n',
      ".zitadel/policies/b.test.json": '{ "operation": "b" }\n',
    });
    await commitAll(dir, "policies");
    const sha = await headOf(dir);
    await git(dir, "mv", ".zitadel/policies/a.json", ".zitadel/policies/a.test.json");
    await git(dir, "mv", ".zitadel/policies/b.test.json", ".zitadel/policies/b.json");

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(statusesOf(files)).toEqual([
      { path: ".zitadel/policies/a.json", status: "deleted" },
      { path: ".zitadel/policies/b.json", status: "added" },
    ]);
  });

  it("reports a removed file as deleted", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await rm(join(dir, MARKER));

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(statusesOf(files)).toEqual([{ path: MARKER, status: "deleted" }]);
  });

  it("reports a moved file as renamed, with where it came from", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await git(dir, "mv", MARKER, ".zitadel/schemas/moved.json");

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(files).toEqual([
      expect.objectContaining({
        path: ".zitadel/schemas/moved.json",
        status: "renamed",
        previous_path: MARKER,
      }),
    ]);
  });

  it("reports a file replaced by a symlink once, as modified", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await rm(join(dir, MARKER));
    await symlink("elsewhere.json", join(dir, MARKER));

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(files).toEqual([
      {
        path: MARKER,
        status: "modified",
        patch: expect.stringMatching(/deleted file mode[\s\S]*new file mode 120000/),
      },
    ]);
  });

  it("joins back into exactly the diff the terminal shows", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, {
      [MARKER]: '{ "edited": true }\n',
      ".zitadel/flows/kiosk login.json": "{}\n",
      '.zitadel/flows/say "hi".json': "{}\n",
      ".zitadel/flows/émigré.json": "{}\n",
    });
    const shown = await diffConfigAgainst(dir, sha, false);

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(
      files
        ?.map((file) => {
          return file.patch;
        })
        .join(""),
    ).toBe(shown);
  });

  it("names a file by its own path, however git would quote it", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { '.zitadel/schemas/say "hi" émigré.json': "{}\n" });

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(statusesOf(files)).toEqual([
      { path: '.zitadel/schemas/say "hi" émigré.json', status: "added" },
    ]);
  });

  it("names files from the project, not the repository root above it", async ({ dir }) => {
    const project = join(dir, "apps", "web");
    await git(dir, "init", "--quiet");
    await write(project, { [MARKER]: "{}\n" });
    await commitAll(dir, "initial");
    const sha = await headOf(dir);
    await write(project, { [MARKER]: '{ "edited": true }\n' });

    const files = await diffConfigFilesAgainst(project, sha);

    expect(statusesOf(files)).toEqual([{ path: MARKER, status: "modified" }]);
  });

  it("never reports .zitadel/secret, which is not part of a release", async ({ dir }) => {
    const sha = await aCleanCommit(dir);
    await write(dir, { ".zitadel/secret": '{ "project_secret": "sk_live" }\n' });

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(files).toEqual([]);
  });

  it("reports no files when nothing changed", async ({ dir }) => {
    const sha = await aCleanCommit(dir);

    const files = await diffConfigFilesAgainst(dir, sha);

    expect(files).toEqual([]);
  });

  it("returns null when the commit is not in this repository's history", async ({ dir }) => {
    await aCleanCommit(dir);

    const files = await diffConfigFilesAgainst(dir, UNKNOWN_COMMIT);

    expect(files).toBeNull();
  });
});
