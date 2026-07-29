#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";

const FAILURE_STATUSES = new Set(["failed", "invalid", "timed-out"]);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultCacheDir = join(repoRoot, ".moon", "cache");

export function actionName(action) {
  const target = action?.node?.params?.target;
  if (action?.node?.action === "run-task" && typeof target === "string") {
    return target;
  }
  return typeof action?.label === "string" && action.label ? action.label : "unknown";
}

export function actionError(action) {
  return typeof action?.error === "string" ? action.error.trim() : "";
}

export function normalizeFailures(report) {
  const actions = Array.isArray(report?.actions) ? report.actions : [];
  return actions
    .filter((action) => FAILURE_STATUSES.has(action?.status))
    .map((action) => ({
      name: actionName(action),
      status: action.status,
      error: actionError(action),
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

export function formatFailureReport(failures) {
  const lines = [`Failed moon tasks (${failures.length}):`];
  for (const failure of failures) {
    lines.push(`- ${failure.name} (${failure.status})`);
    if (failure.error) {
      lines.push(`  error: ${failure.error}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatGithubAnnotations(failures) {
  return failures.map((failure) => {
    const detail = failure.error ? `${failure.name}: ${failure.error}` : failure.name;
    return `::error title=Moon task failed::${escapeAnnotation(detail)}`;
  });
}

export function formatStepSummary(failures) {
  const rows = failures.map((failure) => {
    const error = failure.error ? escapeMarkdownTableCell(failure.error) : "";
    return `| \`${failure.name}\` | ${failure.status} | ${error} |`;
  });
  return [
    "## Failed Moon tasks",
    "",
    `Moon reported **${failures.length}** failed action${failures.length === 1 ? "" : "s"}.`,
    "",
    "| Task | Status | Error |",
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

  const cacheDir = options.cacheDir ?? defaultCacheDir;
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

  const failures = normalizeFailures(loaded.report);
  if (failures.length === 0) {
    console.log(`No failed moon actions in ${loaded.path}.`);
    return { failedCount: 0, skipped: false, path: loaded.path };
  }

  process.stdout.write(formatFailureReport(failures));
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

Reads moon's ciReport.json (or runReport.json) and prints failed tasks for CI logs.
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
