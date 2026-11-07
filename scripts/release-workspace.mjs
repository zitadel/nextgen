/**
 * The release workspace: a copy of the checkout's sources in
 * dist/release/workspace, where release.mjs runs the release builds before it
 * builds the server and packs. Each release build cleans and rebuilds its
 * package's dist/ (the console's: the server's embed). In the copy they never
 * touch the dist/ folders the checkout's own builds, tests and lanes read, so
 * the release graph waits for no test and any other run can go on beside it.
 *
 * The copy holds what git sees in the checkout: tracked and untracked files,
 * no ignored ones, so nothing built in the checkout reaches a release. Its
 * generated files come from the release graph's own generators, which restore
 * from the runner's cache. It gets a git repository of its own on the
 * checkout's HEAD commit, and an install from the same store.
 */
import { chmod, copyFile, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { run, runCapture, withWorkspaceTools } from "./dev-process.mjs";
import { runnerCommand, taskRunner } from "./task-runner.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

// What a release ships: every public package's release build, through the
// aggregate, and the console's, which the server embeds.
export const RELEASE_BUILD_TARGETS = ["release:build-public-packages", "console:build-release"];

// The variables moon sets on the task it runs. They describe the checkout,
// and a moon started inside the task would take them for its own workspace.
const OUTER_TASK_VARIABLES = new Set([
  "MOON_CACHE_DIR",
  "MOON_PROJECT_ID",
  "MOON_PROJECT_ROOT",
  "MOON_PROJECT_SNAPSHOT",
  "MOON_PROJECT_SOURCE",
  "MOON_TARGET",
  "MOON_TASK_HASH",
  "MOON_TASK_ID",
  "MOON_TASK_RETRY_ATTEMPT",
  "MOON_TASK_RETRY_TOTAL",
  "MOON_WORKING_DIR",
  "MOON_WORKSPACE_ROOT",
]);

const COPY_CONCURRENCY = 32;

export function releaseWorkspaceDir(repoRoot = defaultRepoRoot) {
  return join(repoRoot, "dist", "release", "workspace");
}

/**
 * Copies the checkout's sources into a fresh release workspace, installs it
 * and runs the release builds there with the runner that started this
 * process. Returns the workspace's root.
 */
export async function prepareReleaseWorkspace(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const dir = options.dir ?? releaseWorkspaceDir(repoRoot);
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;
  const outerEnv = options.env ?? process.env;
  const env = withWorkspaceTools(releaseWorkspaceEnv(outerEnv), { repoRoot: dir });

  await copySources({ repoRoot, dir, runCapture: runCaptureFn });
  await initRepository({ repoRoot, dir, env, run: runFn });
  await runFn("corepack", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: dir,
    env,
  });
  const build = releaseBuildCommand({ repoRoot, env: outerEnv });
  await runFn(build.command, build.args, { cwd: dir, env });
  return dir;
}

/**
 * The release builds' command line, for the runner that started this
 * process. Turbo keeps its local cache in the repository it runs in, so the
 * workspace's turbo reads and writes the checkout's: what the checkout's runs
 * have generated restores in the copy.
 */
export function releaseBuildCommand({ repoRoot = defaultRepoRoot, env = process.env } = {}) {
  const { command, args } = runnerCommand(RELEASE_BUILD_TARGETS, env);
  if (taskRunner(env) === "turbo") {
    return { command, args: [...args, `--cache-dir=${join(repoRoot, ".turbo", "cache")}`] };
  }
  return { command, args };
}

export function releaseWorkspaceEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !OUTER_TASK_VARIABLES.has(key)));
}

/**
 * Replaces `dir` with the files git sees in the checkout: tracked ones as
 * they are on disk, and untracked ones that are not ignored. A tracked file
 * deleted on disk stays out, and so does a directory git lists in place of
 * its contents (a nested repository).
 */
export async function copySources({
  repoRoot = defaultRepoRoot,
  dir,
  runCapture: runCaptureFn = runCapture,
}) {
  const { stdout } = await runCaptureFn(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot },
  );
  const files = [...new Set(stdout.split("\0").filter((file) => file && !file.endsWith("/")))];

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next];
      next += 1;
      await copyEntry(join(repoRoot, file), join(dir, file));
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, files.length) }, worker));
  return files.length;
}

async function copyEntry(source, target) {
  let stats;
  try {
    stats = await lstat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stats.isDirectory()) return;

  await mkdir(dirname(target), { recursive: true });
  if (stats.isSymbolicLink()) {
    await symlink(await readlink(source), target);
    return;
  }
  await copyFile(source, target);
  await chmod(target, stats.mode & 0o7777);
}

// The checkout's HEAD commit, with the copied files staged over it. The
// runners hash task inputs through git, and Go stamps the server binary with
// the revision of the repository it builds in and whether its files differ
// (vcs.revision, vcs.modified): both stay the checkout's. `--force` stages
// the tracked files a .gitignore also matches. The identity is for the
// annotated tags `changeset publish` creates here; nothing pushes them.
async function initRepository({ repoRoot, dir, env, run: runFn }) {
  const git = (args) => runFn("git", args, { cwd: dir, env });
  await git(["init", "--quiet", "--initial-branch=release"]);
  await git(["config", "user.name", "release workspace"]);
  await git(["config", "user.email", "release-workspace@localhost"]);
  await git(["fetch", "--quiet", "--depth=1", "--no-tags", repoRoot, "HEAD"]);
  await git(["update-ref", "HEAD", "FETCH_HEAD"]);
  await git(["add", "--all", "--force"]);
}
