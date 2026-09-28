#!/usr/bin/env node
import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

const FAILURE_STATUSES = new Set(["failed", "invalid", "timed-out"]);
const REPORT_FILE_NAMES = ["ciReport.json", "runReport.json"];
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultCacheDir = join(repoRoot, ".moon", "cache");

export function actionName(action) {
  const target = action?.node?.params?.target;
  if (action?.node?.action === "run-task" && typeof target === "string") {
    return target;
  }
  return typeof action?.label === "string" && action.label ? action.label : "unknown";
}

/**
 * A failed task's `error` is always the same sentence ("Task <target> failed to
 * run."), so the exit code from its task-execution operation is the only detail
 * worth carrying: 127 reads as a missing binary, 1 as a check that rejected the
 * tree. Setup and sync actions run no task and do put a real message in `error`.
 */
export function actionDetail(action) {
  const operations = Array.isArray(action?.operations) ? action.operations : [];
  const execution = operations.find((operation) => operation?.meta?.type === "task-execution");
  if (typeof execution?.meta?.exitCode === "number") {
    return `exit ${execution.meta.exitCode}`;
  }
  return typeof action?.error === "string" ? action.error.trim() : "";
}

export function normalizeFailures(report) {
  const actions = Array.isArray(report?.actions) ? report.actions : [];
  return actions
    .filter((action) => FAILURE_STATUSES.has(action?.status))
    .map((action) => ({
      name: actionName(action),
      status: action.status,
      detail: actionDetail(action),
    }));
}

/** GitHub Actions workflow-command escaping (% first, then CR/LF). */
export function escapeAnnotation(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape markdown table cells; collapse newlines so rows stay single-line. */
export function escapeMarkdownTableCell(value) {
  return value
    .replace(/\r?\n/g, " / ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
}

export function formatGithubAnnotations(failures) {
  return failures.map((failure) => {
    const summary = failure.detail
      ? `${failure.name} ${failure.status} (${failure.detail})`
      : `${failure.name} ${failure.status}`;
    return `::error title=Moon task failed::${escapeAnnotation(summary)}`;
  });
}

export function formatStepSummary(failures) {
  const rows = failures.map((failure) => {
    const detail = failure.detail ? escapeMarkdownTableCell(failure.detail) : "";
    return `| \`${failure.name}\` | ${failure.status} | ${detail} |`;
  });
  return [
    "## Failed Moon tasks",
    "",
    `Moon reported **${failures.length}** failed action${failures.length === 1 ? "" : "s"}.`,
    "",
    "| Task | Status | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function loadMoonReport(options = {}) {
  if (options.reportPath) {
    const raw = await readFile(options.reportPath, "utf8");
    return { report: JSON.parse(raw), path: options.reportPath };
  }

  // `moon ci` writes ciReport.json and `moon run` writes runReport.json into the
  // same cache dir, so a job that does both leaves two reports behind. Read the
  // newest: preferring a fixed name reports the earlier step's failures.
  const cacheDir = options.cacheDir ?? defaultCacheDir;
  const candidates = [];
  for (const fileName of REPORT_FILE_NAMES) {
    const candidate = join(cacheDir, fileName);
    try {
      const stats = await stat(candidate);
      candidates.push({ path: candidate, modifiedAt: stats.mtimeMs });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const newest = candidates[0].path;
  return { report: JSON.parse(await readFile(newest, "utf8")), path: newest };
}

export async function reportMoonFailures(options = {}) {
  const loaded = await loadMoonReport(options);
  if (!loaded) {
    console.log("No moon ciReport.json / runReport.json found; skipping failure report.");
    return { failedCount: 0, skipped: true };
  }

  const failures = normalizeFailures(loaded.report);
  if (failures.length === 0) {
    console.log(`No failed moon actions in ${loaded.path}.`);
    return { failedCount: 0, skipped: false, path: loaded.path };
  }

  // No plain-text block here: MOON_SUMMARY (set on the CI job) already prints a
  // named pass/fail list and replays failed task output into the same log.
  for (const annotation of formatGithubAnnotations(failures)) {
    console.log(annotation);
  }

  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
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
  await reportMoonFailures(options);
  return 0;
}

function parseArgs(argv) {
  const options = { help: false, reportPath: undefined, cacheDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--report" || arg === "--cache-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--report") {
        options.reportPath = value;
      } else {
        options.cacheDir = value;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    throw new Error(`Unexpected argument: ${arg} (use --report <path>)`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/report-moon-failures.mjs [--report <path>] [--cache-dir <dir>]

Reads moon's newest report (ciReport.json / runReport.json) and turns failed
actions into GitHub Actions error annotations plus a job-summary table, so a
failure is visible on the run page without opening the job log.
Always exits 0 so a missing report cannot replace the moon step's exit code.
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
