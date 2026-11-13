#!/usr/bin/env node
// Renders a `turbo run --summarize` file as Markdown for a GitHub job summary:
// the run's totals, the critical path that set its wall time, and the slowest
// tasks that ran. ci.yml appends the output to $GITHUB_STEP_SUMMARY.
//
//   node scripts/turbo-run-summary.mjs [summary.json | runs-dir]
//
// With no argument it reads the newest file in .turbo/runs.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SLOWEST = 15;

// Each branch's bound is where its rounding would reach the next unit, so
// 59.96s reads `1m 00s`, not `60.0s`. A missing timing reads `–`.
export function seconds(ms) {
  if (!Number.isFinite(ms)) return "–";
  if (ms < 999.5) return `${Math.round(ms)}ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function duration(task) {
  return task.execution ? task.execution.endTime - task.execution.startTime : 0;
}

function cacheLabel(task) {
  const cache = task.cache ?? {};
  if (cache.status !== "HIT") return "miss";
  return cache.source === "REMOTE" ? "remote hit" : "local hit";
}

// The chain that ends with the last task to finish, walked back through the
// dependency that finished last each time. `wait` is the gap between that
// dependency's end and the task's start: time the task spent queued for a
// concurrency slot rather than blocked on its inputs.
export function criticalPath(tasks) {
  const byId = new Map(tasks.filter((t) => t.execution).map((t) => [t.taskId, t]));
  let current = [...byId.values()].sort((a, b) => b.execution.endTime - a.execution.endTime)[0];
  const path = [];
  while (current) {
    const deps = (current.dependencies ?? []).map((id) => byId.get(id)).filter(Boolean);
    const blocker = deps.sort((a, b) => b.execution.endTime - a.execution.endTime)[0];
    path.unshift({
      task: current,
      wait: blocker ? Math.max(0, current.execution.startTime - blocker.execution.endTime) : 0,
    });
    current = blocker;
  }
  return path;
}

export function renderSummary(summary) {
  const tasks = summary.tasks ?? [];
  const exec = summary.execution ?? {};
  const wall = exec.endTime - exec.startTime;
  const ran = tasks.filter((t) => t.cache?.status !== "HIT" && t.execution);
  const hits = tasks.filter((t) => t.cache?.status === "HIT");
  const remoteHits = hits.filter((t) => t.cache.source === "REMOTE").length;
  const busy = ran.reduce((sum, t) => sum + duration(t), 0);
  const saved = hits.reduce((sum, t) => sum + (t.cache.timeSaved ?? 0), 0);
  const failed = tasks.filter(
    (t) => t.execution && t.execution.exitCode !== 0 && t.execution.exitCode != null,
  );

  const lines = [];
  lines.push(`## Turborepo run`, "");
  lines.push(
    `| Wall time | Tasks | Ran | Cache hits | Failed | Task time | Avg. parallelism | Time saved by cache |`,
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  lines.push(
    `| ${seconds(wall)} | ${tasks.length} | ${ran.length} | ${hits.length} (${remoteHits} remote) | ${failed.length} | ${seconds(busy)} | ${wall > 0 ? (busy / wall).toFixed(1) : "–"}× | ${seconds(saved)} |`,
  );
  lines.push("");

  if (failed.length > 0) {
    lines.push(`**Failed:** ${failed.map((t) => `\`${t.taskId}\``).join(", ")}`, "");
  }

  const path = criticalPath(tasks);
  if (path.length > 0) {
    lines.push(`### Critical path`, "");
    lines.push(
      `The chain that ended last. *Queued* is time a task waited for a free slot after its last dependency finished.`,
      "",
    );
    lines.push(`| Task | Starts at | Took | Queued | Cache |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const { task, wait } of path) {
      lines.push(
        `| \`${task.taskId}\` | +${seconds(task.execution.startTime - exec.startTime)} | ${seconds(duration(task))} | ${wait > 0 ? seconds(wait) : "–"} | ${cacheLabel(task)} |`,
      );
    }
    lines.push("");
  }

  const slowest = [...ran].sort((a, b) => duration(b) - duration(a));
  if (slowest.length > 0) {
    lines.push(`### Slowest tasks that ran`, "");
    lines.push(`| Task | Took | Starts at | Share of task time |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const task of slowest.slice(0, SLOWEST)) {
      lines.push(
        `| \`${task.taskId}\` | ${seconds(duration(task))} | +${seconds(task.execution.startTime - exec.startTime)} | ${busy > 0 ? ((duration(task) / busy) * 100).toFixed(0) : 0}% |`,
      );
    }
    lines.push("");
    if (slowest.length > SLOWEST) {
      lines.push(`<details><summary>All ${slowest.length} tasks that ran</summary>`, "");
      lines.push(`| Task | Took |`);
      lines.push(`| --- | --- |`);
      for (const task of slowest) lines.push(`| \`${task.taskId}\` | ${seconds(duration(task))} |`);
      lines.push("", `</details>`, "");
    }
  }

  return lines.join("\n");
}

async function resolveSummaryFile(arg) {
  const target = arg ?? ".turbo/runs";
  if (!(await stat(target)).isDirectory()) return target;
  const files = (await readdir(target)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`no run summary in ${target}`);
  const dated = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await stat(join(target, f))).mtimeMs })),
  );
  return join(target, dated.sort((a, b) => b.mtime - a.mtime)[0].f);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = await resolveSummaryFile(process.argv[2]);
  process.stdout.write(renderSummary(JSON.parse(await readFile(file, "utf8"))));
}
