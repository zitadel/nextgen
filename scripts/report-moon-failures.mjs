#!/usr/bin/env node
/**
 * Print failed moon ci / moon run targets in plain text for GitHub Actions.
 *
 * Moon's status markers are color-only, so GHA logs often show only
 * "1 failed" without naming the task. This script reads ciReport.json
 * (or runReport.json) and emits annotations plus a step summary.
 *
 * Always exits 0 so a missing report cannot replace the Moon step's
 * failure as the job's primary exit reason.
 */
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

const FAILURE_STATUSES = new Set(["failed", "invalid", "timed-out"]);
const LABEL_TARGET_PATTERN = /^Run(?:Target|Task)\((.+)\)$/;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultCacheDir = join(repoRoot, ".moon", "cache");

export function actionTarget(action) {
  const node = action?.node;
  if (node && typeof node === "object") {
    if (node.action === "run-task" && typeof node.params?.target === "string") {
      return node.params.target;
    }
    // Older moon reports used a `type` discriminator.
    if (node.type === "run-target" && typeof node.target === "string") {
      return node.target;
    }
  }

  const label = typeof action?.label === "string" ? action.label : "";
  const match = label.match(LABEL_TARGET_PATTERN);
  if (match) {
    return match[1];
  }
  return label || null;
}

export function collectFailedActions(report) {
  const actions = Array.isArray(report?.actions) ? report.actions : [];
  return actions.filter((action) => FAILURE_STATUSES.has(action?.status));
}

export function formatFailureReport(failedActions) {
  const lines = [];
  const names = failedActions.map((action) => actionTarget(action) ?? "unknown");

  lines.push(`Failed moon tasks (${names.length}):`);
  for (const action of failedActions) {
    const name = actionTarget(action) ?? "unknown";
    const status = action?.status ?? "failed";
    lines.push(`- ${name} (${status})`);
    if (typeof action?.error === "string" && action.error.trim()) {
      lines.push(`  error: ${action.error.trim()}`);
    }
  }
  return { names, text: `${lines.join("\n")}\n` };
}

export function formatGithubAnnotations(failedActions) {
  return failedActions.map((action) => {
    const name = actionTarget(action) ?? "unknown";
    const detail =
      typeof action?.error === "string" && action.error.trim()
        ? `${name}: ${action.error.trim()}`
        : name;
    // Escape newlines for the annotation protocol.
    const message = detail.replace(/\r?\n/g, "%0A");
    return `::error title=Moon task failed::${message}`;
  });
}

export function formatStepSummary(failedActions) {
  const { names } = formatFailureReport(failedActions);
  const rows = failedActions.map((action) => {
    const name = actionTarget(action) ?? "unknown";
    const status = action?.status ?? "failed";
    const error =
      typeof action?.error === "string" && action.error.trim()
        ? action.error.trim().replace(/\|/g, "\\|")
        : "";
    return `| \`${name}\` | ${status} | ${error} |`;
  });

  return [
    "## Failed Moon tasks",
    "",
    `Moon reported **${names.length}** failed action${names.length === 1 ? "" : "s"}.`,
    "",
    "| Task | Status | Error |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function loadMoonReport(options = {}) {
  const cacheDir = options.cacheDir ?? defaultCacheDir;
  const reportPath = options.reportPath;
  if (reportPath) {
    const raw = await readFile(reportPath, "utf8");
    return { report: JSON.parse(raw), path: reportPath };
  }

  for (const fileName of ["ciReport.json", "runReport.json"]) {
    const candidate = join(cacheDir, fileName);
    try {
      const raw = await readFile(candidate, "utf8");
      return { report: JSON.parse(raw), path: candidate };
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function reportMoonFailures(options = {}) {
  const loaded = await loadMoonReport(options);
  if (!loaded) {
    console.log("No moon ciReport.json / runReport.json found; skipping failure report.");
    return { failedCount: 0, skipped: true };
  }

  const failedActions = collectFailedActions(loaded.report);
  if (failedActions.length === 0) {
    console.log(`No failed moon actions in ${loaded.path}.`);
    return { failedCount: 0, skipped: false, path: loaded.path };
  }

  const { text } = formatFailureReport(failedActions);
  process.stdout.write(text);

  for (const annotation of formatGithubAnnotations(failedActions)) {
    console.log(annotation);
  }

  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, formatStepSummary(failedActions));
  }

  return { failedCount: failedActions.length, skipped: false, path: loaded.path };
}

export async function main(argv = process.argv.slice(2)) {
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
    } else if (arg === "--report") {
      options.reportPath = argv[++i];
    } else if (arg === "--cache-dir") {
      options.cacheDir = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      options.reportPath = arg;
    }
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/report-moon-failures.mjs [--report <path>] [--cache-dir <dir>]

Reads moon's ciReport.json (or runReport.json) and prints failed tasks for CI logs.
`);
}

if (isDirectRun(import.meta.url)) {
  main(forwardedArgs()).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      // Still exit 0: never override the moon step's failure as the primary cause.
      process.exitCode = 0;
    },
  );
}
