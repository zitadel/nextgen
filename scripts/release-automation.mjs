#!/usr/bin/env node
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeChangedEntries, parseNameStatus } from "./check-changesets-status.mjs";
import { forwardedArgs, isDirectRun, runCapture } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export function parseArgs(args) {
  const parsed = {
    mode: args[0] ?? "",
    base: "HEAD^",
    message: "",
    summary: false,
    help: false,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--base requires a value");
      }
      parsed.base = value;
      index += 1;
      continue;
    }
    if (arg === "--message") {
      parsed.message = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      parsed.summary = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return parsed;
}

export async function detectReleaseAutomation(options) {
  const mode = options.mode;
  const root = options.repoRoot ?? repoRoot;
  const pendingChangesets = options.pendingChangesets ?? (await readPendingChangesets(root));
  const prereleaseChangesetIds = normalizeChangesetIdSet(
    options.prereleaseChangesetIds ?? (await readPrereleaseChangesetIds(root)),
  );
  const unrecordedPendingChangesets = findUnrecordedPendingChangesets(
    pendingChangesets,
    prereleaseChangesetIds,
  );

  if (mode === "prepare") {
    const shouldRun = unrecordedPendingChangesets.length > 0;
    return {
      ok: true,
      mode,
      shouldRun,
      reason: prepareReason({ pendingChangesets, unrecordedPendingChangesets }),
      pendingChangesets,
      unrecordedPendingChangesets,
      changedFiles: [],
      errors: [],
    };
  }

  if (mode !== "publish") {
    throw new Error(`unknown release automation mode: ${mode || "(empty)"}`);
  }

  const base = normalizeBase(options.base ?? "HEAD^");
  const entries = options.entries ?? (await gitChangedEntries(root, base));
  const analysis = analyzeChangedEntries(entries, { versionPr: true });
  const message = options.message ?? (await readHeadCommitMessage(root));
  const versionCommit = isVersionPackageCommit(message);
  const errors = [];

  if (versionCommit && unrecordedPendingChangesets.length > 0) {
    errors.push(
      `version package commit still has pending changesets not recorded in .changeset/pre.json: ${unrecordedPendingChangesets.join(", ")}`,
    );
  }
  if (versionCommit && !analysis.versionOutputOnly) {
    errors.push("version package commit changed files outside Changesets version output");
  }

  const shouldRun = versionCommit && unrecordedPendingChangesets.length === 0 && analysis.versionOnly;
  return {
    ok: errors.length === 0,
    mode,
    shouldRun,
    reason: publishReason({ versionCommit, unrecordedPendingChangesets, analysis, errors }),
    base,
    message,
    pendingChangesets,
    unrecordedPendingChangesets,
    changedFiles: analysis.changedFiles,
    errors,
  };
}

export function isVersionPackageCommit(message) {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => /^build: version packages(?:\s|\(|$)/.test(line));
}

export function renderStepSummary(result) {
  const lines = [
    "# Release automation",
    "",
    `Mode: ${result.mode}`,
    `Should run: ${result.shouldRun ? "yes" : "no"}`,
    `Reason: ${result.reason}`,
    "",
  ];

  if (result.pendingChangesets.length > 0) {
    lines.push("## Pending changesets", "");
    for (const file of result.pendingChangesets) {
      lines.push(`- \`${file}\``);
    }
    lines.push("");
  }

  if (result.unrecordedPendingChangesets?.length > 0) {
    lines.push("## Pending changesets not recorded in prerelease state", "");
    for (const file of result.unrecordedPendingChangesets) {
      lines.push(`- \`${file}\``);
    }
    lines.push("");
  } else if (result.pendingChangesets.length > 0) {
    lines.push("All pending changesets are recorded in `.changeset/pre.json`.", "");
  }

  if (result.changedFiles.length > 0) {
    lines.push("## Changed files", "");
    for (const file of result.changedFiles.slice(0, 30)) {
      lines.push(`- \`${file}\``);
    }
    if (result.changedFiles.length > 30) {
      lines.push(`- and ${result.changedFiles.length - 30} more`);
    }
    lines.push("");
  }

  if (result.errors.length > 0) {
    lines.push("## Errors", "");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function main(args = forwardedArgs(), options = {}) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    printUsage();
    return 0;
  }

  const result = await detectReleaseAutomation({
    repoRoot: options.repoRoot ?? repoRoot,
    mode: parsed.mode,
    base: parsed.base,
    message: parsed.message || undefined,
    entries: options.entries,
    pendingChangesets: options.pendingChangesets,
  });

  await writeOutputs(result, options.outputPath ?? process.env.GITHUB_OUTPUT);
  const summary = renderStepSummary(result);
  if (parsed.summary) {
    await writeSummary(summary, options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY);
  }

  if (!result.ok) {
    console.error(`release ${result.mode} automation: failed - ${result.reason}`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  console.log(`release ${result.mode} automation: ${result.shouldRun ? "run" : "skip"} - ${result.reason}`);
  return 0;
}

export async function readPendingChangesets(root) {
  const entries = await readdir(join(root, ".changeset"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => `.changeset/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export async function readPrereleaseChangesetIds(root) {
  try {
    const source = await readFile(join(root, ".changeset/pre.json"), "utf8");
    const parsed = JSON.parse(source);
    if (parsed?.mode !== "pre" || !Array.isArray(parsed.changesets)) {
      return new Set();
    }
    return new Set(parsed.changesets.map((id) => String(id)));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export function findUnrecordedPendingChangesets(pendingChangesets, prereleaseChangesetIds) {
  const ids = normalizeChangesetIdSet(prereleaseChangesetIds);
  return pendingChangesets.filter((file) => !ids.has(changesetIdFromFile(file)));
}

async function gitChangedEntries(root, base) {
  const range = `${normalizeBase(base)}..HEAD`;
  const output = await runCapture("git", ["diff", "--name-status", range], { cwd: root });
  return parseNameStatus(output.stdout);
}

async function readHeadCommitMessage(root) {
  const output = await runCapture("git", ["log", "-1", "--pretty=%B"], { cwd: root });
  return output.stdout;
}

async function writeOutputs(result, outputPath) {
  if (!outputPath) {
    return;
  }
  const lines = [
    `should_run=${result.shouldRun ? "true" : "false"}`,
    `reason=${sanitizeOutput(result.reason)}`,
  ];
  if (result.base) {
    lines.push(`base=${sanitizeOutput(result.base)}`);
  }
  await appendFile(outputPath, `${lines.join("\n")}\n`);
}

async function writeSummary(summary, summaryPath) {
  if (summaryPath) {
    await appendFile(summaryPath, summary);
    return;
  }
  console.log(summary);
}

function prepareReason({ pendingChangesets, unrecordedPendingChangesets }) {
  if (pendingChangesets.length === 0) {
    return "no pending changeset files";
  }
  if (unrecordedPendingChangesets.length === 0) {
    return "pending changesets are already recorded in .changeset/pre.json";
  }
  return `found ${unrecordedPendingChangesets.length} pending changeset file(s) needing version prepare`;
}

function publishReason({ versionCommit, unrecordedPendingChangesets, analysis, errors }) {
  if (errors.length > 0) {
    return "release commit preflight failed";
  }
  if (!versionCommit) {
    return "latest commit is not a Changesets version package commit";
  }
  if (unrecordedPendingChangesets.length > 0) {
    return "pending changesets are not recorded in .changeset/pre.json";
  }
  if (!analysis.versionOnly) {
    return "version package commit has no publishable package version output";
  }
  return "Changesets version package commit detected";
}

function normalizeChangesetIdSet(ids) {
  if (ids instanceof Set) {
    return ids;
  }
  return new Set((ids ?? []).map((id) => String(id)));
}

function changesetIdFromFile(file) {
  return file.split("/").at(-1)?.replace(/\.md$/, "") ?? file;
}

function normalizeBase(base) {
  if (!base || /^0+$/.test(base)) {
    return "HEAD^";
  }
  return base;
}

function sanitizeOutput(value) {
  return String(value).replace(/\r?\n/g, " ");
}

function printUsage() {
  console.log(`Usage: node scripts/release-automation.mjs <prepare|publish> [--base <ref>] [--message <text>] [--summary]

Detects whether automatic release prepare or publish should run for the current checkout.
`);
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
