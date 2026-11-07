#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, runCapture } from "./dev-process.mjs";
import { PUBLIC_PACKAGE_BUILD_TARGETS } from "./release-manifest.mjs";
import { RELEASE_BUILD_TARGETS } from "./release-workspace.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_AGGREGATE_TARGET = "release:build-public-packages";
const LEGACY_GLOBAL_CLEAN_TARGET = "release:clean-public-package-dist";
const RELEASE_UI_BUILD_REQUIREMENTS = new Map([
  // The console's Vite build resolves the workspace packages from source,
  // except these two, which have no `@zitadel/source` entry: it bundles their
  // dist (components also directly, in the branding preview).
  ["console:build-release", ["sdk-react:build-release", "components:build-release"]],
]);
const BUILD_MUTEX_REQUIREMENTS = new Map([["sdk-nuxt:build-release", "sdk-nuxt-dist"]]);
const RELEASE_ENTRYPOINT_TARGETS = ["release:pack", "release:snapshot", "release:publish"];

// The release entry points run the release builds in the release workspace,
// a copy of the checkout's sources, as one run of RELEASE_BUILD_TARGETS
// (scripts/release-workspace.mjs). There each release build cleans and
// rewrites its package's dist, in parallel wherever its deps allow. The
// checks below keep that safe:
//
// - Each release build, the UI release builds included, depends on the
//   release build of every package its normal build depends on. The normal
//   builds run in parallel on those edges, so with them no release build
//   reads a dist another release build is rewriting.
// - The release run holds no test and no normal build of a public package:
//   a test would read a dist while it is cleaned, and a normal build would
//   rewrite one beside or after its release build.
// - The entry points have no deps, so no release build runs in the checkout,
//   where its builds, tests and lanes read the dist folders.

export async function main(args = forwardedArgs()) {
  if (args.includes("--help")) {
    console.log("usage: node scripts/check-release-graph.mjs");
    return;
  }

  if (args.length > 0) {
    throw new Error(`unknown arguments: ${args.join(" ")}`);
  }

  const releaseRun = [PUBLIC_AGGREGATE_TARGET, ...RELEASE_UI_BUILD_REQUIREMENTS.keys()];
  if (RELEASE_BUILD_TARGETS.join(" ") !== releaseRun.join(" ")) {
    throw new Error(
      `the release workspace must run ${releaseRun.join(" ")}, ` +
        `not ${RELEASE_BUILD_TARGETS.join(" ")} (scripts/release-workspace.mjs)`,
    );
  }

  const publicGraph = await readTaskGraph(PUBLIC_AGGREGATE_TARGET);
  const publicTasks = indexTasks(publicGraph);

  assertTaskOption(publicTasks, PUBLIC_AGGREGATE_TARGET, "runInCI", false);

  const aggregateDeps = directDeps(publicTasks, PUBLIC_AGGREGATE_TARGET);
  if (aggregateDeps.has(LEGACY_GLOBAL_CLEAN_TARGET)) {
    throw new Error(
      `${PUBLIC_AGGREGATE_TARGET} must not list ${LEGACY_GLOBAL_CLEAN_TARGET} ` +
        "as a sibling dep; each release build must clean its own dist instead.",
    );
  }

  const normalBuildDeps = await readNormalBuildDeps();
  for (const target of PUBLIC_PACKAGE_BUILD_TARGETS) {
    assertTask(publicTasks, target);
    assertTaskOption(publicTasks, target, "runInCI", false);
    assertReleaseBuildCleans(publicTasks, target);
    assertBuildMutex(publicTasks, target);
    assertSelfBuildNotInReleaseGraph(publicTasks, target);
    assertMirrorsNormalBuildEdges(publicTasks, target, normalBuildDeps);

    if (!aggregateDeps.has(target)) {
      throw new Error(`${PUBLIC_AGGREGATE_TARGET} is missing manifest build target ${target}`);
    }
  }
  assertNoTest(publicTasks, PUBLIC_AGGREGATE_TARGET);
  assertNoPublicNormalBuild(publicTasks, PUBLIC_AGGREGATE_TARGET);

  for (const [target, releaseBuildTargets] of RELEASE_UI_BUILD_REQUIREMENTS) {
    const graph = await readTaskGraph(target);
    const tasks = indexTasks(graph);
    assertTask(tasks, target);

    for (const releaseBuildTarget of releaseBuildTargets) {
      if (!reaches(tasks, target, releaseBuildTarget)) {
        throw new Error(`${target} does not depend on ${releaseBuildTarget}`);
      }

      assertTaskOption(tasks, releaseBuildTarget, "runInCI", false);
      assertReleaseBuildCleans(tasks, releaseBuildTarget);
      assertBuildMutex(tasks, releaseBuildTarget);
    }

    assertMirrorsNormalBuildEdges(tasks, target, normalBuildDeps);
    assertNoTest(tasks, target);
    assertNoPublicNormalBuild(tasks, target);
  }

  for (const target of RELEASE_ENTRYPOINT_TARGETS) {
    const task = await readTask(target);
    assertTaskRunInCI(task, false);
    const deps = (task.deps ?? []).map((dep) => dep.target);
    if (deps.length > 0) {
      throw new Error(
        `${target} must have no deps (${deps.join(", ")}): it runs the release ` +
          "builds in the release workspace (scripts/release-workspace.mjs), and " +
          "a dep would run its graph in the checkout.",
      );
    }
  }

  console.log(
    "release graph ok: public package release builds clean and rebuild dist " +
      "without self-build readers and mirror their normal builds' package edges, " +
      "the release workspace's run holds no test and no public normal build, and " +
      `the entry points have no deps; ${RELEASE_UI_BUILD_REQUIREMENTS.size} release UI ` +
      "builds depend on the package release builds they consume, never on their normal builds",
  );
}

async function readTaskGraph(target) {
  const result = await runCapture("moon", ["task-graph", target, "--json"], {
    cwd: repoRoot,
  });

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `failed to parse moon task graph for ${target}: ${formatError(error)}\n` +
        result.stdout.slice(0, 1000),
    );
  }
}

async function readTask(target) {
  const result = await runCapture("moon", ["task", target, "--json"], {
    cwd: repoRoot,
  });

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `failed to parse moon task for ${target}: ${formatError(error)}\n` +
        result.stdout.slice(0, 1000),
    );
  }
}

// Every project's normal `build` task and its deps, by target. The query
// matches task ids by prefix, so pick `build` itself.
async function readNormalBuildDeps() {
  const result = await runCapture("moon", ["query", "tasks", "--id", "build"], {
    cwd: repoRoot,
  });

  let tasksByProject;
  try {
    ({ tasks: tasksByProject } = JSON.parse(result.stdout));
  } catch (error) {
    throw new Error(
      `failed to parse moon build tasks: ${formatError(error)}\n${result.stdout.slice(0, 1000)}`,
    );
  }

  const deps = new Map();
  for (const tasks of Object.values(tasksByProject ?? {})) {
    if (tasks.build) {
      deps.set(
        tasks.build.target,
        (tasks.build.deps ?? []).map((dep) => dep.target),
      );
    }
  }
  return deps;
}

function indexTasks(graph) {
  const tasks = new Map();
  for (const task of Object.values(graph.data ?? {})) {
    tasks.set(task.target, task);
  }
  return tasks;
}

function assertTask(tasks, target) {
  if (!tasks.has(target)) {
    throw new Error(`moon graph is missing ${target}`);
  }
}

function assertTaskOption(tasks, target, option, expected) {
  assertTask(tasks, target);
  const task = tasks.get(target);

  if (task.options?.[option] !== expected) {
    throw new Error(`${target} must set options.${option} to ${String(expected)}`);
  }
}

function assertTaskRunInCI(task, expected) {
  if (task.options?.runInCI !== expected) {
    throw new Error(`${task.target} must set options.runInCI to ${String(expected)}`);
  }
}

function assertBuildMutex(tasks, target) {
  const expected = BUILD_MUTEX_REQUIREMENTS.get(target);
  if (!expected) {
    return;
  }

  assertTaskOption(tasks, target, "mutex", expected);
}

function assertSelfBuildNotInReleaseGraph(tasks, target) {
  const buildTarget = normalBuildTargetFor(target);
  if (reaches(tasks, target, buildTarget)) {
    throw new Error(
      `${target} must not depend on ${buildTarget}; release builds clean and ` +
        "rebuild their own dist, and normal build readers can race that cleanup.",
    );
  }
}

function assertReleaseBuildCleans(tasks, target) {
  assertTask(tasks, target);
  const task = tasks.get(target);
  const script = task.script ?? [task.command, ...(task.args ?? [])].join(" ");

  if (!script.includes("release-clean.mjs local-dist")) {
    throw new Error(`${target} must clean local dist inside build-release`);
  }
}

// A normal build's dep on another package's build means it reads that
// package's dist, so the release build must wait for the release build that
// rewrites it (or for the normal build, for a package without one). Any other
// dep, a generator, makes files the build reads: the release workspace starts
// from the checkout's sources alone, so the release build waits for it too.
function assertMirrorsNormalBuildEdges(tasks, target, normalBuildDeps) {
  const buildTarget = normalBuildTargetFor(target);
  if (!normalBuildDeps.has(buildTarget)) {
    throw new Error(`moon build tasks are missing ${buildTarget}`);
  }
  for (const dep of normalBuildDeps.get(buildTarget)) {
    const [project, task] = dep.split(":");
    if (dep === buildTarget) {
      continue;
    }
    if (task !== "build") {
      if (!reaches(tasks, target, dep)) {
        throw new Error(
          `${target} must depend on ${dep}: ${buildTarget} reads what it ` +
            "generates, and the release workspace holds only the checkout's sources.",
        );
      }
      continue;
    }
    const releaseDep = `${project}:build-release`;
    const expected = PUBLIC_PACKAGE_BUILD_TARGETS.includes(releaseDep) ? releaseDep : dep;
    if (!reaches(tasks, target, expected)) {
      throw new Error(
        `${target} must depend on ${expected}: ${buildTarget} depends on ${dep}, ` +
          "and release builds run in parallel, so without the edge it can read " +
          "a dist that is being rewritten.",
      );
    }
  }
}

// A public package's normal build in the release run rewrites that package's
// dist beside or after its release build, and the release would ship it.
function assertNoPublicNormalBuild(tasks, target) {
  const releaseBuildOf = new Map(
    PUBLIC_PACKAGE_BUILD_TARGETS.map((releaseBuild) => [
      normalBuildTargetFor(releaseBuild),
      releaseBuild,
    ]),
  );
  // Breadth first, so the error names the normal build nearest the target.
  const queue = [target];
  for (const current of queue) {
    const releaseBuild = releaseBuildOf.get(current);
    if (releaseBuild) {
      throw new Error(
        `${target} must not depend on ${current}: it rewrites the dist ` +
          `${releaseBuild} produces for the release, so depend on ${releaseBuild}.`,
      );
    }
    for (const dep of directDeps(tasks, current)) {
      if (!queue.includes(dep)) {
        queue.push(dep);
      }
    }
  }
}

// A test in the release run would read a dist a release build is cleaning.
// Tests run in the checkout.
function assertNoTest(tasks, target) {
  const queue = [target];
  for (const current of queue) {
    const [, task] = current.split(":");
    if (task === "test" || task.startsWith("test-")) {
      throw new Error(
        `${target} must not depend on ${current}: the release run builds what ` +
          "a release ships and tests nothing.",
      );
    }
    for (const dep of directDeps(tasks, current)) {
      if (!queue.includes(dep)) {
        queue.push(dep);
      }
    }
  }
}

function directDeps(tasks, target) {
  const task = tasks.get(target);
  assertTask(tasks, target);
  return new Set((task.deps ?? []).map((dep) => dep.target));
}

function reaches(tasks, start, target) {
  const pending = [start];
  const seen = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    if (current === target) {
      return true;
    }

    seen.add(current);
    for (const dep of directDeps(tasks, current)) {
      pending.push(dep);
    }
  }

  return false;
}

function normalBuildTargetFor(buildTarget) {
  const [project] = buildTarget.split(":");
  return `${project}:build`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
