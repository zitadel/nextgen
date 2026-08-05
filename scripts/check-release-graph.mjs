#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import {
  forwardedArgs,
  isDirectRun,
  runCapture,
} from "./dev-process.mjs";
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
const RELEASE_ENTRYPOINT_TARGETS = [
  "release:pack",
  "release:snapshot",
  "release:publish",
];

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

  for (const target of PUBLIC_PACKAGE_BUILD_TARGETS) {
    assertTask(publicTasks, target);
    assertTaskOption(publicTasks, target, "runInCI", false);
    assertReleaseBuildCleans(publicTasks, target);
    assertBuildMutex(publicTasks, target);
    assertSelfBuildNotInReleaseGraph(publicTasks, target);

    if (!aggregateDeps.has(target)) {
      throw new Error(
        `${PUBLIC_AGGREGATE_TARGET} is missing manifest build target ${target}`,
      );
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
  }

  console.log(
    "release graph ok: public package release builds clean and rebuild dist " +
      "without self-build readers, and " +
      `${RELEASE_UI_BUILD_REQUIREMENTS.size} release UI ` +
      "builds depend on the package release chain they consume",
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
    throw new Error(
      `${target} must set options.${option} to ${String(expected)}`,
    );
  }
}

function assertTaskRunInCI(task, expected) {
  if (task.options?.runInCI !== expected) {
    throw new Error(
      `${task.target} must set options.runInCI to ${String(expected)}`,
    );
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
