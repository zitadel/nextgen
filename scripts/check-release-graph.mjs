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
const RELEASE_BUILD_ENTRYPOINTS = [
  "release:pack",
  "release:snapshot",
  "release:build",
];
const PUBLISH_AGGREGATE_TARGET = "release:publish";
// Gate first, then each publish surface in promotion order. The aggregate
// runs deps serially, so this list is also the execution order.
const PUBLISH_SURFACE_ORDER = [
  "release:gate",
  "release:verify-artifacts",
  "release:publish-npm",
  "release:publish-tags",
  "release:publish-container",
  "release:publish-github",
];
const REHEARSE_TARGET = "release:rehearse";
const REHEARSE_DEP_ORDER = [
  "release:build",
  "release:rehearse-plan",
  "release:verify-artifacts",
  "release:publish-container",
  "release:publish-github",
];
// The rehearsal must never schedule the surfaces that mutate remote state by
// default: npm is rehearsed against a local registry inside the rehearse
// command, tags and the gate belong to the real publish path only.
const REHEARSE_FORBIDDEN_TARGETS = [
  "release:gate",
  "release:publish-npm",
  "release:publish-tags",
  PUBLISH_AGGREGATE_TARGET,
];
// Release graphs promote; they never re-verify. Test tasks in a release
// graph re-run in an environment no PR exercised (the alpha.14 release
// failed exactly there: cli:test met a real GITHUB_TOKEN inside publish).
const TEST_TASK_PATTERN = /:(test|test-[a-z-]+)$/;
// The public-dist mutex on cli:test defends explicit multi-target runs where
// release builds clean the package dist the tests import from. No release
// graph schedules cli:test anymore, so only this assertion keeps the mutex
// from being silently dropped.
const TEST_MUTEX_REQUIREMENTS = new Map([["cli:test", "public-dist"]]);

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

  for (const target of RELEASE_BUILD_ENTRYPOINTS) {
    const graph = await readTaskGraph(target);
    const tasks = indexTasks(graph);
    assertTask(tasks, target);
    assertTaskOption(tasks, target, "runInCI", false);
    assertNoTestTasksInGraph(tasks, target);

    if (!reaches(tasks, target, PUBLIC_AGGREGATE_TARGET)) {
      throw new Error(`${target} must depend on ${PUBLIC_AGGREGATE_TARGET}`);
    }
    if (directDeps(tasks, target).has("console:build")) {
      throw new Error(`${target} must use console:build-release, not console:build`);
    }
    for (const uiTarget of RELEASE_UI_BUILD_REQUIREMENTS.keys()) {
      if (!reaches(tasks, target, uiTarget)) {
        throw new Error(`${target} must depend on ${uiTarget}`);
      }
    }
  }

  await assertTestMutexes();

  await assertPublishGraph();
  await assertRehearseGraph();

  console.log(
    "release graph ok: public package release builds clean and rebuild dist " +
      "without self-build readers, " +
      `${RELEASE_UI_BUILD_REQUIREMENTS.size} release UI ` +
      "builds depend on the package release chain they consume, and the " +
      "publish graph promotes built artifacts without rebuilding them",
  );
}

function assertNoTestTasksInGraph(tasks, entrypoint) {
  const testTasks = [...tasks.keys()].filter((target) => TEST_TASK_PATTERN.test(target));
  if (testTasks.length > 0) {
    throw new Error(
      `${entrypoint} graph must not schedule test tasks (release graphs promote, ` +
        `they never re-verify); found: ${testTasks.sort().join(", ")}`,
    );
  }
}

async function assertTestMutexes() {
  for (const [target, expected] of TEST_MUTEX_REQUIREMENTS) {
    const graph = await readTaskGraph(target);
    const tasks = indexTasks(graph);
    assertTaskOption(tasks, target, "mutex", expected);
  }
}

// The rehearsal runs build + dry surfaces in a fixed order and must never
// pull in the gate or the surfaces that mutate remote state by default.
async function assertRehearseGraph() {
  const graph = await readTaskGraph(REHEARSE_TARGET);
  const tasks = indexTasks(graph);
  assertTask(tasks, REHEARSE_TARGET);
  assertTaskOption(tasks, REHEARSE_TARGET, "runInCI", false);
  assertTaskOption(tasks, REHEARSE_TARGET, "runDepsInParallel", false);
  assertNoTestTasksInGraph(tasks, REHEARSE_TARGET);

  const rehearse = tasks.get(REHEARSE_TARGET);
  const orderedDeps = (rehearse.deps ?? []).map((dep) => dep.target);
  if (orderedDeps.join(" ") !== REHEARSE_DEP_ORDER.join(" ")) {
    throw new Error(
      `${REHEARSE_TARGET} deps must be exactly [${REHEARSE_DEP_ORDER.join(", ")}] ` +
        `in that order, got [${orderedDeps.join(", ")}]`,
    );
  }

  const forbidden = REHEARSE_FORBIDDEN_TARGETS.filter((target) => tasks.has(target));
  if (forbidden.length > 0) {
    throw new Error(
      `${REHEARSE_TARGET} graph must not schedule real publish surfaces; ` +
        `found: ${forbidden.sort().join(", ")}`,
    );
  }
}

// The publish aggregate must run gate + surfaces in promotion order and must
// never reach the build chain: the publish job promotes artifacts downloaded
// from the build job, and a rebuild there would publish untested bits.
async function assertPublishGraph() {
  const graph = await readTaskGraph(PUBLISH_AGGREGATE_TARGET);
  const tasks = indexTasks(graph);
  assertTask(tasks, PUBLISH_AGGREGATE_TARGET);
  assertTaskOption(tasks, PUBLISH_AGGREGATE_TARGET, "runInCI", false);
  assertTaskOption(tasks, PUBLISH_AGGREGATE_TARGET, "runDepsInParallel", false);

  const aggregate = tasks.get(PUBLISH_AGGREGATE_TARGET);
  const orderedDeps = (aggregate.deps ?? []).map((dep) => dep.target);
  if (orderedDeps.join(" ") !== PUBLISH_SURFACE_ORDER.join(" ")) {
    throw new Error(
      `${PUBLISH_AGGREGATE_TARGET} deps must be exactly [${PUBLISH_SURFACE_ORDER.join(", ")}] ` +
        `in that order, got [${orderedDeps.join(", ")}]`,
    );
  }

  for (const target of PUBLISH_SURFACE_ORDER) {
    assertTaskOption(tasks, target, "runInCI", false);
  }

  const forbidden = [...tasks.keys()].filter(
    (target) =>
      target === PUBLIC_AGGREGATE_TARGET ||
      target === "release:build" ||
      target.endsWith(":build-release"),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `${PUBLISH_AGGREGATE_TARGET} graph must not rebuild release artifacts; ` +
        `found build tasks: ${forbidden.sort().join(", ")}`,
    );
  }
  assertNoTestTasksInGraph(tasks, PUBLISH_AGGREGATE_TARGET);
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
