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
const RELEASE_UI_CLEAN_REQUIREMENTS = new Map([
  ["console:build-release", ["api:clean-dist"]],
  ["login-ui:build-release", ["api:clean-dist", "components:clean-dist"]],
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
    const cleanTarget = cleanTargetFor(target);
    assertTaskOption(publicTasks, cleanTarget, "runInCI", false);

    if (!aggregateDeps.has(target)) {
      throw new Error(
        `${PUBLIC_AGGREGATE_TARGET} is missing manifest build target ${target}`,
      );
    }

    if (!reaches(publicTasks, target, cleanTarget)) {
      throw new Error(`${target} does not depend on ${cleanTarget}`);
    }
  }

  for (const [target, cleanTargets] of RELEASE_UI_CLEAN_REQUIREMENTS) {
    const graph = await readTaskGraph(target);
    const tasks = indexTasks(graph);
    assertTask(tasks, target);

    for (const cleanTarget of cleanTargets) {
      assertTaskOption(tasks, cleanTarget, "runInCI", false);

      if (!reaches(tasks, target, cleanTarget)) {
        throw new Error(`${target} does not depend on ${cleanTarget}`);
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
    for (const uiTarget of RELEASE_UI_CLEAN_REQUIREMENTS.keys()) {
      if (!deps.has(uiTarget)) {
        throw new Error(`${target} must depend on ${uiTarget}`);
      }
    }
  }

  console.log(
    "release graph ok: every public package release build cleans its own " +
      `dist, and ${RELEASE_UI_CLEAN_REQUIREMENTS.size} release UI builds ` +
      "depend on the package release chain they consume",
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
      `failed to parse moon task graph for ${target}: ${error.message}\n` +
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
      `failed to parse moon task for ${target}: ${error.message}\n` +
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

function cleanTargetFor(buildTarget) {
  const [project] = buildTarget.split(":");
  return `${project}:clean-dist`;
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
