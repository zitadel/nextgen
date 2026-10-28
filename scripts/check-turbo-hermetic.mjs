#!/usr/bin/env node
// The ground truth behind the turbo graph's inputs
// (docs/design/build/turborepo-graph.md): a task that passes in a tree that
// holds only what the graph hashes cannot depend on anything else.
//
// In a scratch worktree of HEAD, it deletes every tracked file that no task's
// inputs and no global dependency claim (keeping what turbo, git and pnpm
// themselves read), then
//
//   1. deletes the files each build leaves out of its inputs too (the test
//      and docs classes) and runs every build without the cache: a build that
//      needs one of them fails (a task a build depends on may fail for want
//      of its tests, a typecheck; the builds it holds back are reported as
//      unverified);
//   2. restores those and runs the whole gate without the cache: a task that
//      reads an unclaimed file fails.
//
// scripts/check-turbo-graph.mjs finds the reads it can see in the code; this
// finds the ones it cannot. CI runs it nightly (turbo-canary.yml).
//
// Usage: node scripts/check-turbo-hermetic.mjs [--keep] [--tasks lint,typecheck,build,test]
// Keep the OS's own TMPDIR: tsx puts its IPC socket there, and a socket path
// past 104 bytes fails every tsx task with `listen EINVAL`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { TURBO_GRAPH_TASKS } from "./ci-mode.mjs";
import { isDirectRun } from "./dev-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Files the tools read themselves, which no task lists: turbo's config, git's
// attributes and ignores, pnpm's workspace and lockfile.
const TOOLCHAIN = [
  /(?:^|\/)turbo\.json$/,
  /(?:^|\/)\.gitignore$/,
  /^\.gitattributes$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  /(?:^|\/)package\.json$/,
];

// The task kinds that produce what other tasks read, which step 1 builds.
const BUILD_KINDS = new Set(["build", "generate", "sync-schemas", "sync:export"]);

/**
 * What the graph claims: every task's inputs and the global dependencies, as
 * repository-relative paths, from a `turbo run … --dry=json` summary.
 */
export function claimedFiles(dry) {
  const claimed = new Set(Object.keys(dry.globalCacheInputs?.files ?? {}));
  for (const task of dry.tasks ?? []) {
    if (task.command === "<NONEXISTENT>") continue;
    for (const file of Object.keys(task.inputs ?? {}))
      claimed.add(posix.join(task.directory ?? "", file));
  }
  return claimed;
}

/** Tracked files no task claims and no tool reads itself. */
export function unclaimedFiles(tracked, claimed) {
  return tracked.filter((file) => !claimed.has(file) && !TOOLCHAIN.some((re) => re.test(file)));
}

/**
 * The files of the builds' packages that no build hashes: the test and docs
 * classes the shared shapes exclude. A file another package's build lists
 * (docs#generate reads the CLI's CHANGELOG.md) stays.
 */
export function buildExcludedFiles(dry, tracked) {
  const dirs = new Set();
  const hashed = new Set();
  for (const task of dry.tasks ?? []) {
    if (task.command === "<NONEXISTENT>" || !BUILD_KINDS.has(task.task)) continue;
    if (task.directory) dirs.add(task.directory);
    for (const file of Object.keys(task.inputs ?? {})) {
      hashed.add(posix.join(task.directory ?? "", file));
    }
  }
  return tracked.filter(
    (file) =>
      [...dirs].some((dir) => file.startsWith(`${dir}/`)) &&
      !hashed.has(file) &&
      !TOOLCHAIN.some((re) => re.test(file)),
  );
}

function run(command, args, { cwd, env = {}, capture = false } = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", ...env },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function remove(cwd, files) {
  for (const file of files) rmSync(join(cwd, file), { force: true });
}

/** The tasks of the newest `--summarize` run in `tree`, by outcome. */
export function outcomes(summary, kinds) {
  const ofKind = (summary.tasks ?? []).filter(
    (task) => task.command !== "<NONEXISTENT>" && kinds.has(task.task),
  );
  return {
    failed: ofKind
      .filter((task) => (task.execution?.exitCode ?? 0) !== 0)
      .map((task) => task.taskId),
    unverified: ofKind.filter((task) => !task.execution).map((task) => task.taskId),
  };
}

function newestSummary(tree) {
  const dir = join(tree, ".turbo", "runs");
  const newest = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .at(-1);
  return JSON.parse(readFileSync(join(dir, newest), "utf8"));
}

function main() {
  const argv = process.argv.slice(2);
  const keep = argv.includes("--keep");
  const tasksAt = argv.indexOf("--tasks");
  const gate = tasksAt >= 0 ? argv[tasksAt + 1].split(",") : ["lint", "typecheck", "build", "test"];

  const scratch = mkdtempSync(join(tmpdir(), "turbo-hermetic-"));
  const tree = join(scratch, "tree");
  const env = { TURBO_CACHE_DIR: join(scratch, "cache") };
  run("git", ["worktree", "add", "--detach", tree, "HEAD"], { cwd: root });
  let failed = false;
  try {
    run("corepack", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"], { cwd: tree });
    const turbo = join(tree, "node_modules", ".bin", "turbo");
    const dry = JSON.parse(
      run(turbo, ["run", ...TURBO_GRAPH_TASKS, "--dry=json"], { cwd: tree, env, capture: true })
        .stdout,
    );
    const tracked = run("git", ["ls-files", "-z"], { cwd: tree, capture: true })
      .stdout.split("\0")
      .filter(Boolean);
    const unclaimed = unclaimedFiles(tracked, claimedFiles(dry));
    const buildExcluded = buildExcludedFiles(dry, tracked).filter(
      (file) => !unclaimed.includes(file),
    );
    console.log(
      `turbo hermetic: ${unclaimed.length} tracked file(s) no task claims; removing them`,
    );
    remove(tree, unclaimed);

    console.log(
      `turbo hermetic: step 1, every build without its ${buildExcluded.length} excluded file(s)`,
    );
    remove(tree, buildExcluded);
    run(
      turbo,
      ["run", ...BUILD_KINDS, "--force", "--continue=dependencies-successful", "--summarize"],
      {
        cwd: tree,
        env,
      },
    );
    const step1 = outcomes(newestSummary(tree), BUILD_KINDS);
    if (step1.failed.length > 0) {
      failed = true;
      console.error(
        `turbo hermetic: these builds need a file their inputs leave out: ${step1.failed.join(", ")}`,
      );
    }
    if (step1.unverified.length > 0) {
      console.log(
        `turbo hermetic: not verified (a dependency failed first): ${step1.unverified.join(", ")}`,
      );
    }
    const pathspec = join(scratch, "restore.txt");
    writeFileSync(pathspec, buildExcluded.join("\0"));
    run("git", ["checkout", `--pathspec-from-file=${pathspec}`, "--pathspec-file-nul"], {
      cwd: tree,
    });

    console.log(`turbo hermetic: step 2, ${gate.join(" ")} without the unclaimed files`);
    const all = run(turbo, ["run", ...gate, "--force", "--continue=dependencies-successful"], {
      cwd: tree,
      env,
    });
    if (all.status !== 0) {
      failed = true;
      console.error("turbo hermetic: a task reads a file no task claims (above)");
    }
  } finally {
    if (keep) {
      console.log(`turbo hermetic: kept ${tree}`);
    } else {
      run("git", ["worktree", "remove", "--force", tree], { cwd: root });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  if (failed) process.exit(1);
  console.log(
    "turbo hermetic: ok - every build and gate task passes on what the graph hashes alone",
  );
}

if (isDirectRun(import.meta.url)) {
  main();
}
