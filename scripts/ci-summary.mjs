#!/usr/bin/env node
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { forwardedArgs } from "./dev-process.mjs";

const options = parseArgs(forwardedArgs());
const diagnosticsDir = process.env.CI_DIAGNOSTICS_DIR || join(process.cwd(), "dist", "ci-diagnostics");
const artifactName = options.artifactName || "ci-diagnostics";
const runUrl = options.runUrl || defaultRunUrl();
const mode = process.env.CI_MODE || "unknown";
const steps = await readSteps(diagnosticsDir);
const status = overallStatus(steps);
const failed = steps.filter((step) => step.status !== "passed");
const summary = await renderSummary({ artifactName, diagnosticsDir, failed, mode, runUrl, status, steps });
const prComment = renderPrComment({ artifactName, failed, mode, runUrl, status, steps });

await mkdir(diagnosticsDir, { recursive: true });
await writeFile(join(diagnosticsDir, "summary.md"), summary);
await writeFile(join(diagnosticsDir, "pr-comment.md"), prComment);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} else {
  console.log(summary);
}

function parseArgs(args) {
  const parsed = { artifactName: "", runUrl: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--artifact-name":
        parsed.artifactName = args[++index] ?? "";
        break;
      case "--run-url":
        parsed.runUrl = args[++index] ?? "";
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readSteps(root) {
  const dir = join(root, "steps");
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const steps = [];
  for (const file of files.filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      steps.push(JSON.parse(await readFile(join(dir, file), "utf8")));
    } catch (error) {
      steps.push({
        id: file.replace(/\.json$/, ""),
        name: file,
        status: "failed",
        durationMs: 0,
        rerun: "",
        error: `could not read step metadata: ${error.message}`,
      });
    }
  }
  return steps.sort((left, right) => String(left.startedAt || "").localeCompare(String(right.startedAt || "")));
}

async function renderSummary(input) {
  const lines = [
    "# CI diagnostics",
    "",
    `Status: ${input.status}`,
    `Mode: ${input.mode}`,
    `Diagnostics artifact: \`${input.artifactName}\``,
    "",
    "## Steps",
    "",
  ];
  if (input.runUrl) {
    lines.splice(4, 0, `Run: [${input.runUrl}](${input.runUrl})`);
  }

  if (input.steps.length === 0) {
    lines.push("No instrumented CI steps wrote diagnostics.", "");
  } else {
    lines.push("| Step | Status | Duration | Rerun |", "| --- | --- | ---: | --- |");
    for (const step of input.steps) {
      lines.push(
        `| ${escapeTable(step.name || step.id)} | ${escapeTable(step.status || "unknown")} | ${formatDuration(step.durationMs)} | ${inlineCode(step.rerun || step.command || "")} |`,
      );
    }
    lines.push("");
  }

  if (input.failed.length > 0) {
    lines.push("## Failed step logs", "");
    for (const step of input.failed) {
      lines.push(`### ${step.name || step.id}`, "");
      if (step.error) {
        lines.push(`Error: ${inlineCode(step.error)}`, "");
      }
      if (step.rerun) {
        lines.push(`Rerun: ${inlineCode(step.rerun)}`, "");
      }
      const tail = await readLogTail(join(input.diagnosticsDir, step.logFile || ""), 120);
      if (tail) {
        lines.push("```text", tail, "```", "");
      } else {
        lines.push("No log output was captured for this step.", "");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderPrComment(input) {
  const firstFailed = input.failed[0];
  const lines = [
    "<!-- zitadel-ci-diagnostics -->",
    "### CI diagnostics",
    "",
    `Status: ${input.status}`,
    `Mode: ${input.mode}`,
    `Diagnostics artifact: \`${input.artifactName}\``,
    "",
  ];
  if (input.runUrl) {
    lines.splice(5, 0, `Run: [open workflow run](${input.runUrl})`);
  }

  if (firstFailed) {
    lines.push(`First failing step: \`${firstFailed.name || firstFailed.id}\``);
    if (firstFailed.rerun) {
      lines.push(`Rerun locally: ${inlineCode(firstFailed.rerun)}`);
    }
    lines.push("");
  }

  if (input.steps.length > 0) {
    lines.push("| Step | Status | Rerun |", "| --- | --- | --- |");
    for (const step of input.steps) {
      lines.push(
        `| ${escapeTable(step.name || step.id)} | ${escapeTable(step.status || "unknown")} | ${inlineCode(step.rerun || step.command || "")} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("No instrumented CI steps wrote diagnostics.", "");
  }

  lines.push("Full logs are in the CI diagnostics artifact and the workflow run summary.");
  return `${lines.join("\n")}\n`;
}

async function readLogTail(path, maxLines) {
  if (!path) return "";
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/).slice(-maxLines).join("\n").trimEnd();
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function overallStatus(steps) {
  if (steps.length === 0) {
    return "unknown";
  }
  return steps.some((step) => step.status !== "passed") ? "failed" : "passed";
}

function formatDuration(value) {
  const ms = Number(value) || 0;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function inlineCode(value) {
  const text = String(value || "");
  if (!text) return "";
  return `\`${text.replaceAll("`", "\\`")}\``;
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function defaultRunUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : "";
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: node scripts/ci-summary.mjs [--artifact-name <name>] [--run-url <url>]

Reads CI_DIAGNOSTICS_DIR/steps/*.json and writes summary.md plus pr-comment.md.`);
  process.exit(error ? 1 : 0);
}
