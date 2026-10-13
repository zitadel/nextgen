#!/usr/bin/env node
import { appendFile, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

// The turbo counterpart of report-moon-failures.mjs: `turbo run --summarize`
// writes one JSON file per run into .turbo/runs; this turns its failed tasks
// into GitHub Actions error annotations and a job-summary table.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultRunsDir = join(repoRoot, ".turbo", "runs");

/**
 * A failed task carries its exit code under `execution`; a task turbo never
 * started because a dependency failed has no `execution` at all and is not a
 * failure of its own.
 */
export function normalizeFailures(summary) {
  const tasks = Array.isArray(summary?.tasks) ? summary.tasks : [];
  return tasks
    .filter((task) => {
      const execution = task?.execution;
      return (
        execution &&
        ((typeof execution.exitCode === "number" && execution.exitCode !== 0) ||
          typeof execution.error === "string")
      );
    })
    .map((task) => ({
      name: typeof task.taskId === "string" ? task.taskId : "unknown",
      status: "failed",
      detail:
        typeof task.execution.exitCode === "number"
          ? `exit ${task.execution.exitCode}`
          : String(task.execution.error).trim(),
    }));
}

/** GitHub Actions workflow-command escaping (% first, then CR/LF). */
export function escapeAnnotation(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape markdown table cells; collapse newlines so rows stay single-line. */
export function escapeMarkdownTableCell(value) {
  return value.replace(/\r?\n/g, " / ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function formatGithubAnnotations(failures) {
  return failures.map((failure) => {
    const summary = failure.detail
      ? `${failure.name} ${failure.status} (${failure.detail})`
      : `${failure.name} ${failure.status}`;
    return `::error title=Turbo task failed::${escapeAnnotation(summary)}`;
  });
}

export function formatStepSummary(failures) {
  const rows = failures.map((failure) => {
    const detail = failure.detail ? escapeMarkdownTableCell(failure.detail) : "";
    return `| \`${failure.name}\` | ${failure.status} | ${detail} |`;
  });
  return [
    "## Failed turbo tasks",
    "",
    `turbo reported **${failures.length}** failed task${failures.length === 1 ? "" : "s"}.`,
    "",
    "| Task | Status | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** The newest run summary, or null when the directory holds none. */
export async function loadTurboSummary(options = {}) {
  if (options.summaryFile) {
    const raw = await readFile(options.summaryFile, "utf8");
    return { summary: JSON.parse(raw), path: options.summaryFile };
  }
  const runsDir = options.runsDir ?? defaultRunsDir;
  let names;
  try {
    names = await readdir(runsDir);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const candidates = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const path = join(runsDir, name);
    candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const newest = candidates[0].path;
  return { summary: JSON.parse(await readFile(newest, "utf8")), path: newest };
}

export async function reportTurboFailures(options = {}) {
  const loaded = await loadTurboSummary(options);
  if (!loaded) {
    console.log("No turbo run summary found; skipping failure report.");
    return { failedCount: 0, skipped: true };
  }

  const failures = normalizeFailures(loaded.summary);
  if (failures.length === 0) {
    console.log(`No failed turbo tasks in ${loaded.path}.`);
    return { failedCount: 0, skipped: false, path: loaded.path };
  }

  for (const annotation of formatGithubAnnotations(failures)) {
    console.log(annotation);
  }

  const summaryPath = options.stepSummaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, formatStepSummary(failures));
  }

  return { failedCount: failures.length, skipped: false, path: loaded.path };
}

export async function main(argv = forwardedArgs()) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return 0;
  }
  await reportTurboFailures(options);
  return 0;
}

function parseArgs(argv) {
  const options = { help: false, summaryFile: undefined, runsDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--summary" || arg === "--runs-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--summary") {
        options.summaryFile = value;
      } else {
        options.runsDir = value;
      }
      i += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg} (use --summary <path> or --runs-dir <dir>)`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/report-turbo-failures.mjs [--summary <path>] [--runs-dir <dir>]

Reads the newest run summary \`turbo run --summarize\` wrote (.turbo/runs/*.json)
and turns its failed tasks into GitHub Actions error annotations plus a
job-summary table, so a failure is visible on the run page without opening
the job log. Always exits 0 so a missing summary cannot replace the turbo
step's exit code.
`);
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 0;
    },
  );
}
