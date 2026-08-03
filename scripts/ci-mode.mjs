#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { isDirectRun } from "./dev-process.mjs";

// Decides what the ci workflow runs, in two layers:
//
// 1. `mode` — `version-only` for Changesets version PRs, else `full`.
// 2. Affected gates — within full mode, the expensive tail steps (Go suites,
//    release snapshot, journeys, real-instance e2e) are skipped when moon's
//    affected task selection proves the change cannot reach them. Selection
//    uses `moon query tasks --affected --downstream deep`: the deep dependent
//    walk is what makes multi-hop chains (console → server:build → e2e
//    suites) select correctly — `moon ci`'s own selection only marks direct
//    dependents, which is not enough here.
//
// The gates fail open: known repo-wide files no task claims (workflow
// definitions, scripts/, moon config, root manifests and compiler/release
// inputs) force a full run, an empty diff forces a full run, a failing or
// unparsable query forces a full run, and an empty affected set forces a
// full run unless every changed file is on the explicit inert allowlist —
// unclaimed files are not assumed inert. A gate may only ever skip work
// that provably cannot be affected.

// Files whose effects moon cannot see (nothing lists them as task inputs)
// but which reach builds, tests, or release artifacts anyway. Any touched
// file matching here disables all gating for the run — even when the rest
// of the diff produced a non-empty affected set, because moon's answer says
// nothing about these files.
const FORCE_FULL_PREFIXES = [".github/", ".moon/", "scripts/"];
const FORCE_FULL_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".changeset/config.json",
  // Repo-wide compiler/release inputs no task claims: nearly every workspace
  // tsconfig extends the base, and the release archives ship the root
  // README/LICENSE files.
  "tsconfig.base.json",
  "LICENSE",
  "LICENSING.md",
  "README.md",
]);

// The ONLY files allowed to produce a skip when moon claims nothing in the
// diff. Unclaimed ≠ inert (tsconfig.base.json is unclaimed and breaks every
// typecheck), so an empty affected set fails open unless every changed file
// is on this list. Keep it narrow; growing it requires proving the file
// reaches no build, test, or shipped artifact.
const INERT_UNCLAIMED_PREFIXES = ["docs/"];
const INERT_UNCLAIMED_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);

function isInertWhenUnclaimed(file) {
  return (
    INERT_UNCLAIMED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    INERT_UNCLAIMED_FILES.has(file)
  );
}

// Workflow steps run fixed targets, so gates are membership checks on the
// affected set. Journeys and the snapshot are coupled both ways: the journeys
// consume the snapshot's tarballs through the filesystem (no moon dep edge
// exists), so either being affected must run both.
const GO_TEST_TARGETS = [
  "server:check-generate",
  "server:test",
  "server:test-postgres",
  "server:test-spanner",
  "server:test-sqlite",
];
const TESTING_DEMO_TARGETS = ["testing:test-integration", "demo-next-e2e:e2e-real"];
const CONSOLE_E2E_TARGET = "console-e2e:e2e-real";
const SNAPSHOT_TARGET = "release:snapshot";
const JOURNEY_PROJECT_PREFIX = "cli-journey-e2e:";

const ALL_GATES = ["go_tests", "snapshot", "journeys", "suites_testing_demo", "suites_console", "browsers"];

export function computeMode(files) {
  return files.length > 0 && files.every(isVersionOutputFile) ? "version-only" : "full";
}

export function forceFullReason(files) {
  if (files.length === 0) {
    return "empty diff";
  }
  const trigger = files.find(
    (file) =>
      FORCE_FULL_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
      FORCE_FULL_FILES.has(file) ||
      file.split("/").at(-1) === "moon.yml",
  );
  return trigger ? `unclaimed file ${trigger}` : null;
}

/**
 * Compute the step gates for a run. `targets` is the affected task set
 * (`project:task` strings) from moon, or null when the query failed —
 * which fails open.
 */
export function resolveGates({ mode, files, targets }) {
  if (mode === "version-only") {
    return { gates: Object.fromEntries(ALL_GATES.map((g) => [g, false])), reason: "version-only" };
  }
  const forced =
    forceFullReason(files) ??
    (targets === null ? "affected query failed" : null) ??
    (targets.length === 0 && !files.every(isInertWhenUnclaimed)
      ? "empty affected set for files outside the inert allowlist"
      : null);
  if (forced) {
    return { gates: Object.fromEntries(ALL_GATES.map((g) => [g, true])), reason: forced };
  }
  const set = new Set(targets);
  const journeys =
    targets.some((t) => t.startsWith(JOURNEY_PROJECT_PREFIX)) || set.has(SNAPSHOT_TARGET);
  const suitesTestingDemo = TESTING_DEMO_TARGETS.some((t) => set.has(t));
  const suitesConsole = set.has(CONSOLE_E2E_TARGET);
  const gates = {
    go_tests: GO_TEST_TARGETS.some((t) => set.has(t)),
    // The snapshot exists in PR CI to feed the journeys, so the gates are one.
    snapshot: journeys,
    journeys,
    suites_testing_demo: suitesTestingDemo,
    suites_console: suitesConsole,
    browsers:
      suitesTestingDemo ||
      suitesConsole ||
      journeys ||
      targets.some((t) => t.endsWith(":test-browser")),
  };
  return { gates, reason: null };
}

export function queryAffectedTargets(base, spawn = spawnSync) {
  const result = spawn("moon", ["query", "tasks", "--affected", "--downstream", "deep"], {
    encoding: "utf8",
    env: { ...process.env, MOON_BASE: base },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    return null;
  }
  try {
    const tasks = JSON.parse(result.stdout)?.tasks;
    // An empty `tasks` object is a valid query answer, but resolveGates only
    // accepts it as a skip when every changed file is on the inert
    // allowlist — unclaimed is not the same as inert. A missing or
    // non-object `tasks` key means the output schema changed — fail open.
    if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
      return null;
    }
    return Object.entries(tasks).flatMap(([project, projectTasks]) =>
      Object.keys(projectTasks).map((task) => `${project}:${task}`),
    );
  } catch {
    return null;
  }
}

function isVersionOutputFile(file) {
  return file === "pnpm-lock.yaml" ||
    file === ".changeset/pre.json" ||
    file === ".changeset/config.json" ||
    file.startsWith(".changeset/") ||
    file.endsWith("/package.json") ||
    file.endsWith("/CHANGELOG.md");
}

function main() {
  const base = process.argv[2] || "origin/main";
  const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });
  if (diff.status !== 0) {
    process.stderr.write(diff.stderr);
    process.exit(diff.status ?? 1);
  }
  const files = diff.stdout.split(/\r?\n/).filter(Boolean);
  const mode = computeMode(files);

  const needsQuery = mode === "full" && forceFullReason(files) === null;
  const targets = needsQuery ? queryAffectedTargets(base) : [];
  const { gates, reason } = resolveGates({ mode, files, targets });

  const lines = [`mode=${mode}`, ...ALL_GATES.map((g) => `${g}=${gates[g]}`)];
  for (const line of lines) {
    console.log(line);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  const skipped = ALL_GATES.filter((g) => !gates[g]);
  if (process.env.GITHUB_STEP_SUMMARY && mode === "full") {
    const note = reason
      ? `CI gating: full run (${reason}).`
      : skipped.length === 0
        ? "CI gating: all lanes affected."
        : `CI gating: skipped by affected-selection: ${skipped.join(", ")}.`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, note + "\n");
  }
}

if (isDirectRun(import.meta.url)) {
  main();
}
