import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  deployMessage,
  diffConfigAgainst,
  diffConfigFilesAgainst,
  worktreeIsDirty,
} from "../../../../src/lib/release/git";

const run = promisify(execFile);

let dir: string;

/** A temp git repo with one clean commit holding a `.zitadel/` file. */
async function cleanRepo(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-git-"));
  await mkdir(join(dir, ".zitadel", "schemas"), { recursive: true });
  await writeFile(join(dir, ".zitadel", "schemas", "marker.json"), "{}");
  await writeFile(join(dir, "README.md"), "# app\n");
  const git = (args: string[]): Promise<unknown> => run("git", args, { cwd: dir });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial"]);
  return dir;
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("worktreeIsDirty", () => {
  it("is false for a clean worktree", async () => {
    const cwd = await cleanRepo();

    expect(await worktreeIsDirty(cwd)).toBe(false);
  });

  it("is true for an uncommitted change outside .zitadel/", async () => {
    const cwd = await cleanRepo();

    // The change is in the repo but not under `.zitadel/`: the whole worktree
    // is dirty, which the old `.zitadel/`-only check would have missed.
    await writeFile(join(cwd, "README.md"), "# app\n\nedited\n");

    expect(await worktreeIsDirty(cwd)).toBe(true);
  });

  it("is false when there is no git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-git-norepo-"));
    dir = cwd;

    expect(await worktreeIsDirty(cwd)).toBe(false);
  });
});

describe("deployMessage", () => {
  it("takes -m, trimmed, over the commit subject", async () => {
    const cwd = await cleanRepo();

    expect(await deployMessage("  add company  ", cwd)).toBe("add company");
  });

  it("falls back to the commit subject when -m is blank", async () => {
    const cwd = await cleanRepo();

    expect(await deployMessage("   ", cwd)).toBe("initial");
  });

  it("cuts a commit subject longer than the server records", async () => {
    const cwd = await cleanRepo();
    await run("git", ["commit", "-q", "--allow-empty", "-m", "x".repeat(2000)], { cwd });

    expect(await deployMessage(undefined, cwd)).toHaveLength(1024);
  });

  it("is undefined without -m outside a git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-git-norepo-"));
    dir = cwd;

    expect(await deployMessage(undefined, cwd)).toBeUndefined();
  });
});

describe("diffConfigAgainst", () => {
  it("shows an untracked .zitadel/ file as an addition", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();

    // A brand-new resource is untracked; the release bundle would include it,
    // so the diff must too, though plain `git diff` would omit it.
    await writeFile(join(cwd, ".zitadel", "schemas", "new.json"), '{ "added": true }\n');

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).toContain("new.json");
    expect(diff).toContain("added");
  });

  it("still shows a tracked change, leaving files outside .zitadel/ out", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), '{ "edited": true }\n');
    await writeFile(join(cwd, "README.md"), "# app\n\nedited\n");

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).toContain("marker.json");
    expect(diff).not.toContain("README.md");
  });

  it("shows a referenced template the bundle inlines from outside .zitadel/", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await mkdir(join(cwd, "templates"), { recursive: true });
    await writeFile(join(cwd, "templates", "login.liquid"), "<p>edited</p>\n");

    const diff = await diffConfigAgainst(cwd, sha, false, ["templates/login.liquid"]);

    expect(diff).toContain("login.liquid");
    expect(diff).toContain("edited");
  });

  it("leaves a referenced file out when nothing references it", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await mkdir(join(cwd, "templates"), { recursive: true });
    await writeFile(join(cwd, "templates", "login.liquid"), "<p>edited</p>\n");

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).not.toContain("login.liquid");
  });

  it("never shows .zitadel/secret, which is not part of a release", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await writeFile(join(cwd, ".zitadel", "secret"), '{ "project_secret": "sk_live" }\n');

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).not.toContain("sk_live");
  });

  it("returns null when the commit is not in this repository's history", async () => {
    const cwd = await cleanRepo();

    expect(await diffConfigAgainst(cwd, "0".repeat(40), false)).toBeNull();
  });
});

/** {@link cleanRepo}, with the commit a diff is taken against. */
async function cleanCommit(): Promise<{ cwd: string; sha: string }> {
  const cwd = await cleanRepo();
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd });
  return { cwd, sha: stdout.trim() };
}

describe("diffConfigFilesAgainst", () => {
  it("reports a changed file with its part of the diff", async () => {
    const { cwd, sha } = await cleanCommit();
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), '{ "edited": true }\n');

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files).toEqual([
      {
        path: ".zitadel/schemas/marker.json",
        status: "modified",
        patch: expect.stringContaining('+{ "edited": true }'),
      },
    ]);
  });

  it("reports an untracked file as added", async () => {
    const { cwd, sha } = await cleanCommit();
    await writeFile(join(cwd, ".zitadel", "schemas", "new.json"), '{ "added": true }\n');

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files?.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: ".zitadel/schemas/new.json", status: "added" },
    ]);
  });

  it("reports a removed file as deleted", async () => {
    const { cwd, sha } = await cleanCommit();
    await rm(join(cwd, ".zitadel", "schemas", "marker.json"));

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files?.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: ".zitadel/schemas/marker.json", status: "deleted" },
    ]);
  });

  it("reports a moved file as renamed, with where it came from", async () => {
    const { cwd, sha } = await cleanCommit();
    await run("git", ["mv", ".zitadel/schemas/marker.json", ".zitadel/schemas/moved.json"], {
      cwd,
    });

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(
      files?.map(({ path, status, previous_path }) => ({ path, status, previous_path })),
    ).toEqual([
      {
        path: ".zitadel/schemas/moved.json",
        status: "renamed",
        previous_path: ".zitadel/schemas/marker.json",
      },
    ]);
  });

  it("reports a file replaced by a symlink once, as modified", async () => {
    const { cwd, sha } = await cleanCommit();
    // git shows a change of file type as a deletion and a creation under one
    // header: both halves belong to the one file.
    await rm(join(cwd, ".zitadel", "schemas", "marker.json"));
    await symlink("elsewhere.json", join(cwd, ".zitadel", "schemas", "marker.json"));

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files).toEqual([
      {
        path: ".zitadel/schemas/marker.json",
        status: "modified",
        patch: expect.stringMatching(/deleted file mode[\s\S]*new file mode 120000/),
      },
    ]);
  });

  it("joins back into exactly the diff the terminal shows", async () => {
    const { cwd, sha } = await cleanCommit();
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), '{ "edited": true }\n');
    await mkdir(join(cwd, ".zitadel", "flows"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "flows", "kiosk login.json"), "{}\n");
    await writeFile(join(cwd, ".zitadel", "flows", 'say "hi".json'), "{}\n");
    await writeFile(join(cwd, ".zitadel", "flows", "émigré.json"), "{}\n");

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files?.map((file) => file.patch).join("")).toBe(
      await diffConfigAgainst(cwd, sha, false),
    );
  });

  it("names a file by its own path, however git would quote it", async () => {
    const { cwd, sha } = await cleanCommit();
    await writeFile(join(cwd, ".zitadel", "schemas", 'say "hi" émigré.json'), "{}\n");

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files?.map((file) => file.path)).toEqual(['.zitadel/schemas/say "hi" émigré.json']);
  });

  it("names files from the project, not the repository root above it", async () => {
    dir = await mkdtemp(join(tmpdir(), "zitadel-git-monorepo-"));
    const cwd = join(dir, "apps", "web");
    await mkdir(join(cwd, ".zitadel", "schemas"), { recursive: true });
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), "{}\n");
    const git = (args: string[]) => run("git", args, { cwd: dir });
    await git(["init", "-q"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "initial"]);
    const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), '{ "edited": true }\n');

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files?.map((file) => file.path)).toEqual([".zitadel/schemas/marker.json"]);
  });

  it("never reports .zitadel/secret, which is not part of a release", async () => {
    const { cwd, sha } = await cleanCommit();
    await writeFile(join(cwd, ".zitadel", "secret"), '{ "project_secret": "sk_live" }\n');

    const files = await diffConfigFilesAgainst(cwd, sha);

    expect(files).toEqual([]);
  });

  it("reports no files when nothing changed", async () => {
    const { cwd, sha } = await cleanCommit();

    expect(await diffConfigFilesAgainst(cwd, sha)).toEqual([]);
  });

  it("returns null when the commit is not in this repository's history", async () => {
    const { cwd } = await cleanCommit();

    expect(await diffConfigFilesAgainst(cwd, "0".repeat(40))).toBeNull();
  });
});
