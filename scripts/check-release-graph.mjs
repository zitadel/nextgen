#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, runCapture } from "./dev-process.mjs";
import { PUBLIC_PACKAGE_BUILD_TARGETS } from "./release-manifest.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_AGGREGATE_TARGET = "release:build-public-packages";
const LEGACY_GLOBAL_CLEAN_TARGET = "release:clean-public-package-dist";
const RELEASE_UI_BUILD_REQUIREMENTS = new Map([
  ["console:build-release", ["api:build-release"]],
  // login-ui imports components directly; api is covered transitively through
  // components:build-release, but keep both here so the graph check names the
  // full package release chain that login-ui consumes.
  ["login-ui:build-release", ["api:build-release", "components:build-release"]],
]);
const BUILD_MUTEX_REQUIREMENTS = new Map([
  ["api:build-release", "public-dist"],
  ["config:build-release", "public-dist"],
  ["sdk-next:build-release", "public-dist"],
  ["sdk-nuxt:build-release", "sdk-nuxt-dist"],
]);
const RELEASE_ENTRYPOINT_TARGETS = ["release:pack", "release:snapshot", "release:publish"];

// The public package release builds run in parallel wherever their
// dependencies allow, and each one cleans and rewrites its package's dist in
// place. Two checks below keep that safe:
//
// - Each release build depends on the release build of every package its
//   normal build depends on. The normal builds run in parallel in `moon ci` on
//   those edges, so with them no release build reads a dist another release
//   build is rewriting.
// - In every entry point's run, everything else scheduled before packaging
//   (the normal builds and tests, generators, cli:test; server:test in
//   snapshot) finishes before the first release build starts, so no normal
//   task reads or rewrites a dist while it is being cleaned. Tasks after the
//   aggregate run after every release build.

export async function main(args = forwardedArgs()) {
  if (args.includes("--help")) {
    console.log("usage: node scripts/check-release-graph.mjs");
    return;
  }

  if (args.length > 0) {
    throw new Error(`unknown arguments: ${args.join(" ")}`);
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

  for (const [target, releaseBuildTargets] of RELEASE_UI_BUILD_REQUIREMENTS) {
    const graph = await readTaskGraph(target);
    const tasks = indexTasks(graph);
    assertTask(tasks, target);

    for (const releaseBuildTarget of releaseBuildTargets) {
      assertTaskOption(tasks, releaseBuildTarget, "runInCI", false);
      assertReleaseBuildCleans(tasks, releaseBuildTarget);
      assertBuildMutex(tasks, releaseBuildTarget);

      if (!reaches(tasks, target, releaseBuildTarget)) {
        throw new Error(`${target} does not depend on ${releaseBuildTarget}`);
      }
    }
  }

  for (const target of RELEASE_ENTRYPOINT_TARGETS) {
    const task = await readTask(target);
    const deps = new Set((task.deps ?? []).map((dep) => dep.target));
    assertTaskRunInCI(task, false);

    if (!deps.has(PUBLIC_AGGREGATE_TARGET)) {
      throw new Error(`${target} must depend on ${PUBLIC_AGGREGATE_TARGET}`);
    }
    if (deps.has("console:build")) {
      throw new Error(`${target} must use console:build-release, not console:build`);
    }
    for (const uiTarget of RELEASE_UI_BUILD_REQUIREMENTS.keys()) {
      if (!deps.has(uiTarget)) {
        throw new Error(`${target} must depend on ${uiTarget}`);
      }
    }

    assertReleaseBuildsStartAfterOtherWork(await readActionGraph(target), target);
  }

  console.log(
    "release graph ok: public package release builds clean and rebuild dist " +
      "without self-build readers, mirror their normal builds' package edges, " +
      "and start after the other work of each entry point; " +
      `${RELEASE_UI_BUILD_REQUIREMENTS.size} release UI ` +
      "builds depend on the package release builds they consume",
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

// The action graph `moon run <target>` executes: the task deps plus the
// ordering edges moon adds for `runDepsInParallel: false`, which the task
// graph does not show. Returns each run-task action's target and the targets
// it waits for directly.
async function readActionGraph(target) {
  const result = await runCapture("moon", ["action-graph", target, "--json"], {
    cwd: repoRoot,
  });

  let graph;
  try {
    graph = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `failed to parse moon action graph for ${target}: ${formatError(error)}\n` +
        result.stdout.slice(0, 1000),
    );
  }

  const targetOf = new Map();
  for (const [index, node] of Object.entries(graph.data ?? {})) {
    if (node.action === "run-task") {
      targetOf.set(Number(index), node.params.target);
    }
  }
  const waitsFor = new Map([...targetOf.values()].map((runTarget) => [runTarget, new Set()]));
  for (const [from, to] of graph.graph?.edges ?? []) {
    if (targetOf.has(from) && targetOf.has(to)) {
      waitsFor.get(targetOf.get(from)).add(targetOf.get(to));
    }
  }
  return waitsFor;
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
  if (target === "cli:build-release") {
    assertTaskOption(tasks, target, "runDepsInParallel", false);
    if (!reaches(tasks, target, "cli:test")) {
      throw new Error("cli:build-release must depend on cli:test");
    }
    return;
  }

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
// rewrites it (or for the normal build, for a package without one).
function assertMirrorsNormalBuildEdges(tasks, target, normalBuildDeps) {
  const buildTarget = normalBuildTargetFor(target);
  if (!normalBuildDeps.has(buildTarget)) {
    throw new Error(`moon build tasks are missing ${buildTarget}`);
  }
  for (const dep of normalBuildDeps.get(buildTarget)) {
    const [project, task] = dep.split(":");
    if (task !== "build" || dep === buildTarget) {
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

function assertReleaseBuildsStartAfterOtherWork(waitsFor, entryPoint) {
  for (const target of [PUBLIC_AGGREGATE_TARGET, ...PUBLIC_PACKAGE_BUILD_TARGETS]) {
    if (!waitsFor.has(target)) {
      throw new Error(`moon action graph for ${entryPoint} is missing ${target}`);
    }
  }
  const afterRelease = new Set(
    [...waitsFor.keys()].filter((target) => reachesIn(waitsFor, target, PUBLIC_AGGREGATE_TARGET)),
  );

  for (const releaseBuild of PUBLIC_PACKAGE_BUILD_TARGETS) {
    const before = reachableFrom(waitsFor, releaseBuild);
    for (const other of waitsFor.keys()) {
      if (
        PUBLIC_PACKAGE_BUILD_TARGETS.includes(other) ||
        afterRelease.has(other) ||
        other.startsWith("release:") ||
        before.has(other)
      ) {
        continue;
      }
      throw new Error(
        `${releaseBuild} can run beside ${other} in ${entryPoint}; release builds ` +
          "rewrite package dist directories in place, so the other work of the " +
          "run must finish before the first one starts.",
      );
    }
  }
}

function reachableFrom(waitsFor, start) {
  const seen = new Set();
  const pending = [...(waitsFor.get(start) ?? [])];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    pending.push(...(waitsFor.get(current) ?? []));
  }
  return seen;
}

function reachesIn(waitsFor, start, target) {
  return start === target || reachableFrom(waitsFor, start).has(target);
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
