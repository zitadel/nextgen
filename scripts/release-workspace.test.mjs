/**
 * Tests for the release workspace (scripts/release-workspace.mjs): what the
 * copy holds, the release builds' command line, and the order of its steps.
 * The copies run against a throwaway git repository; nothing installs or
 * builds.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, test } from "vitest";

import {
  RELEASE_BUILD_TARGETS,
  copySources,
  prepareReleaseWorkspace,
  releaseBuildCommand,
  releaseWorkspaceEnv,
} from "./release-workspace.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

// A checkout with one file of every kind the copy has to tell apart.
function checkout() {
  const root = mkdtempSync(join(tmpdir(), "release-workspace-test-"));
  roots.push(root);
  git(root, "init", "--quiet", "--initial-branch=main");
  write(root, ".gitignore", "dist\nnode_modules\n");
  write(root, "packages/a/src/index.ts", "export const a = 1;\n");
  write(root, "packages/a/bin/run.js", "#!/usr/bin/env node\n");
  chmodSync(join(root, "packages/a/bin/run.js"), 0o755);
  write(root, "packages/a/gone.ts", "deleted on disk\n");
  write(root, "packages/a/forced/dist/kept.txt", "tracked though ignored\n");
  symlinkSync("src/index.ts", join(root, "packages/a/entry.ts"));
  git(root, "add", ".");
  git(root, "add", "--force", "packages/a/forced/dist/kept.txt");
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base");

  rmSync(join(root, "packages/a/gone.ts"));
  write(root, "packages/a/src/index.ts", "export const a = 2;\n");
  write(root, "packages/a/src/new.ts", "untracked\n");
  write(root, "packages/a/dist/index.js", "built in the checkout\n");
  write(root, "node_modules/x/index.js", "installed\n");
  return root;
}

test("the copy holds the checkout's sources as they are on disk, and nothing ignored", async () => {
  const root = checkout();
  const dir = join(root, "dist/release/workspace");
  write(dir, "stale.txt", "from an earlier run\n");

  await copySources({ repoRoot: root, dir });

  const read = (file) => readFileSync(join(dir, file), "utf8");
  assert.equal(read("packages/a/src/index.ts"), "export const a = 2;\n");
  assert.equal(read("packages/a/src/new.ts"), "untracked\n");
  assert.equal(read("packages/a/forced/dist/kept.txt"), "tracked though ignored\n");
  assert.equal(lstatSync(join(dir, "packages/a/bin/run.js")).mode & 0o111, 0o111);
  assert.equal(readlinkSync(join(dir, "packages/a/entry.ts")), "src/index.ts");
  for (const file of [
    "packages/a/gone.ts",
    "packages/a/dist/index.js",
    "node_modules/x/index.js",
    "stale.txt",
    // The copy sits in the checkout's ignored dist/ and never copies itself.
    "dist/release/workspace/stale.txt",
  ]) {
    assert.equal(existsSync(join(dir, file)), false, file);
  }
});

test("a nested repository stays out of the copy", async () => {
  const root = checkout();
  const nested = join(root, "vendor/other");
  mkdirSync(nested, { recursive: true });
  git(nested, "init", "--quiet");
  write(nested, "file.txt", "another repository's\n");
  const dir = join(root, "dist/release/workspace");

  await copySources({ repoRoot: root, dir });

  assert.equal(existsSync(join(dir, "vendor")), false);
});

test("the release builds run on the runner that started the release", () => {
  assert.deepEqual(releaseBuildCommand({ repoRoot: "/repo", env: {} }), {
    command: "moon",
    args: ["run", ...RELEASE_BUILD_TARGETS],
  });
  assert.deepEqual(releaseBuildCommand({ repoRoot: "/repo", env: { TURBO_HASH: "abc" } }), {
    command: "turbo",
    args: [
      "run",
      "build-public-packages",
      "build-release",
      "--filter=@zitadel/release",
      "--filter=@zitadel/console",
      "--cache-dir=/repo/.turbo/cache",
    ],
  });
});

test("moon's task variables stay out of the workspace's runs", () => {
  const env = releaseWorkspaceEnv({
    PATH: "/bin",
    MOON_WORKSPACE_ROOT: "/checkout",
    MOON_CACHE_DIR: "/checkout/.moon/cache",
    MOON_TARGET: "release:snapshot",
    MOON_BASE: "origin/main",
    TURBO_TOKEN: "token",
  });
  assert.deepEqual(env, { PATH: "/bin", MOON_BASE: "origin/main", TURBO_TOKEN: "token" });
});

test("the workspace is staged on the checkout's commit, installed and built, in that order", async () => {
  const root = checkout();
  const dir = join(root, "dist/release/workspace");
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    if (command === "git") execFileSync(command, args, { cwd: options.cwd, stdio: "ignore" });
  };

  const result = await prepareReleaseWorkspace({
    repoRoot: root,
    run,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, MOON_WORKSPACE_ROOT: root },
  });

  assert.equal(result, dir);
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args[0]]),
    [
      ["git", "init"],
      ["git", "config"],
      ["git", "config"],
      ["git", "fetch"],
      ["git", "update-ref"],
      ["git", "add"],
      ["corepack", "pnpm"],
      ["moon", "run"],
    ],
  );
  assert.deepEqual(calls.at(-2).args, ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"]);
  for (const call of calls) {
    assert.equal(call.cwd, dir);
    assert.equal(call.env.MOON_WORKSPACE_ROOT, undefined);
  }
  const head = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  assert.equal(head(dir), head(root));
  // The checkout's own changes, as Go's vcs.modified and the runners see them.
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  assert.deepEqual(status.trim().split("\n").sort(), [
    "A  packages/a/src/new.ts",
    "D  packages/a/gone.ts",
    "M  packages/a/src/index.ts",
  ]);
});
