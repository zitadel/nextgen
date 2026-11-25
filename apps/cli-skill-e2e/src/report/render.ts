import type { CheckResult } from "../grading.ts";
import type { Stage } from "../journey.ts";
import type { ParsedStage, TranscriptEntry } from "../transcript.ts";
import { clientScript } from "./client-script.ts";
import {
  badge,
  bubble,
  commandBlock,
  duration,
  escapeHtml,
  fileBlock,
  timestamp,
  took,
} from "./html.ts";
import { markdownToHtml } from "./markdown.ts";
import { type Group, metricsFor, percent } from "./metrics.ts";
import { REPORT_CSS } from "./styles.ts";

/** Where and when the report was made, for the header and footer. */
export interface RunMeta {
  readonly generatedAt: string;
  readonly host: string;
  readonly node: string;
  readonly simModel: string;
  readonly branch: string;
  readonly commit: string;
  readonly dirty: boolean;
}

export interface ReportData {
  readonly journey: string;
  readonly stages: ReadonlyArray<Stage>;
  readonly groups: ReadonlyArray<Group>;
  readonly modelsUsed: string;
  readonly cliVersions: string;
  readonly skillVersions: string;
  readonly meta: RunMeta;
}

const CONFIG_LABELS: Readonly<Record<string, string>> = {
  "with-skill": "With skill",
  baseline: "Baseline (no skill)",
};

const scenarioLabel = (group: Group): string =>
  `${CONFIG_LABELS[group.config] ?? group.config} · ${group.model}`;

const renderEntry = (entry: TranscriptEntry): string => {
  switch (entry.kind) {
    case "command":
      return commandBlock(entry);
    case "file":
      return fileBlock(entry);
    case "text":
      return bubble("agent", "Agent", entry.text, entry.ms);
    case "answer":
      return bubble("answer", "User answer", entry.text);
  }
};

/** The whole stage as a conversation, in order: the prompt, then every message, command and answer. */
const conversation = (prompt: string, transcript: ReadonlyArray<TranscriptEntry>): string =>
  [bubble("prompt", "Prompt", prompt), ...transcript.map(renderEntry)].join("\n");

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The stage's tally: questions, commands, failures, then the model's own round trips, which are not questions. */
const tally = (parsed: ParsedStage, steps: number | "?"): string =>
  [
    plural(parsed.counts.questions, "question"),
    `${plural(parsed.counts.commands, "command")}${parsed.counts.failed > 0 ? ` (${parsed.counts.failed} failed)` : ""}`,
    `${steps} model ${steps === 1 ? "step" : "steps"}`,
  ].join(" · ");

interface Slice {
  readonly key: string;
  readonly label: string;
  readonly ms: number;
  readonly hint: string;
}

/** Where the stage's time went, as a bar and a legend, with the slowest commands under it. */
function timingBlock(parsed: ParsedStage): string {
  const { timing } = parsed;
  if (!timing.measured) {
    return "";
  }
  const slices: ReadonlyArray<Slice> = [
    {
      key: "run",
      label: "Commands",
      ms: timing.commandMs,
      hint: "tools running; the skill cannot shrink this",
    },
    {
      key: "model",
      label: "Model",
      ms: timing.modelMs,
      hint: "the agent thinking between commands; fewer calls shrink this",
    },
    {
      key: "start",
      label: "Startup",
      ms: timing.startupMs,
      hint: "the agent starting and closing each turn",
    },
    {
      key: "wait",
      label: "Developer",
      ms: timing.waitMs,
      hint: "the simulated developer answering; not the agent's time",
    },
  ];
  const total = slices.reduce((all, slice) => all + slice.ms, 0);
  if (total <= 0) {
    return "";
  }
  const bar = slices
    .filter((slice) => slice.ms > 0)
    .map(
      (slice) =>
        `<span class="seg ${slice.key}" style="flex:${slice.ms}" title="${escapeHtml(`${slice.label}: ${slice.hint}`)}"></span>`,
    )
    .join("");
  const legend = slices
    .map(
      (slice) =>
        `<li><span class="sw ${slice.key}"></span><span class="tl">${slice.label}</span> <b>${took(slice.ms) || "0s"}</b> <span class="muted">${Math.round((100 * slice.ms) / total)}%</span></li>`,
    )
    .join("");
  const slowest = parsed.transcript
    .flatMap((entry) => (entry.kind === "command" && (entry.ran ?? 0) > 0 ? [entry] : []))
    .toSorted((a, b) => (b.ran ?? 0) - (a.ran ?? 0))
    .slice(0, 3)
    .map(
      (entry) =>
        `<li><b>${took(entry.ran)}</b> <code>${escapeHtml(entry.cmd.replace(/\s+/g, " ").trim().slice(0, 110))}</code></li>`,
    )
    .join("");
  return `<div class="timing"><div class="timing-h">Where the time went</div><div class="bar" role="img" aria-label="Time split between commands, model, startup and developer">${bar}</div><ul class="legend">${legend}</ul>${slowest === "" ? "" : `<div class="timing-h">Slowest commands</div><ol class="slow">${slowest}</ol>`}</div>`;
}

/** What the harness asked the running instance and the app after the agent's turn, and whether reality matched. */
function checksBlock(checks: ReadonlyArray<CheckResult> | undefined): string {
  if (checks === undefined || checks.length === 0) {
    return "";
  }
  const items = checks
    .map(
      (check) =>
        `<li class="asrt ${check.passed ? "ok" : "no"}"><span class="am">${check.passed ? "✓" : "✗"}</span><span class="an">${escapeHtml(check.name)}</span><span class="ae">${markdownToHtml(check.evidence)}</span></li>`,
    )
    .join("");
  return `<div class="asserts"><div class="asserts-h">Live-instance checks</div><ul class="asrt-list">${items}</ul></div>`;
}

function metadataList(data: ReportData, extra = ""): string {
  const { meta, modelsUsed, cliVersions, skillVersions } = data;
  return `<dl class="meta">
  <div><dt>Generated</dt><dd>${timestamp(meta.generatedAt)}</dd></div>
  <div><dt>Commit</dt><dd><code>${escapeHtml(meta.commit || "—")}</code>${meta.dirty ? ' <span class="warn">(working tree modified)</span>' : ""}</dd></div>
  <div><dt>Branch</dt><dd><code>${escapeHtml(meta.branch || "—")}</code></dd></div>
  <div><dt>Host</dt><dd>${escapeHtml(meta.host)}</dd></div>
  <div><dt>Agent model(s)</dt><dd>${escapeHtml(modelsUsed)}</dd></div>
  <div><dt>CLI</dt><dd>${escapeHtml(cliVersions || "—")}</dd></div>
  <div><dt>Skill</dt><dd>${escapeHtml(skillVersions || "—")}</dd></div>
  ${extra}
</dl>`;
}

const scoreboard = ({ groups, stages }: ReportData): string =>
  groups
    .map((group) => {
      const metrics = metricsFor(group, stages);
      return `<span class="score"><b>${escapeHtml(scenarioLabel(group))}</b> ${metrics.verified}/${metrics.runs} verified</span>`;
    })
    .join("");

function metricsTable({ groups, stages }: ReportData): string {
  const rows = groups
    .map((group) => {
      const metrics = metricsFor(group, stages);
      const perSuccess =
        metrics.verified > 0
          ? Math.round(metrics.tokensAll / metrics.verified).toLocaleString()
          : "—";
      const stageCells = metrics.perStage
        .map((tally) => {
          const tone = tally.pass === metrics.runs ? "ok" : tally.pass > 0 ? "mid" : "no";
          return `<td class="sr ${tone}">${tally.pass}/${metrics.runs}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(scenarioLabel(group))}</th><td>${metrics.runs}</td><td><b>${percent(metrics.verified, metrics.runs)}</b> <span class="muted">(${metrics.verified}/${metrics.runs})</span></td><td>${percent(metrics.falseRuns, metrics.runs)} <span class="muted">(${metrics.falseRuns}/${metrics.runs})</span></td><td>${metrics.medianMs > 0 ? duration(metrics.medianMs) : "—"}</td><td>${perSuccess}</td>${stageCells}</tr>`;
    })
    .join("");
  const stageHeads = stages.map((stage) => `<th>S${stage.id}</th>`).join("");
  return `<table class="metrics">
  <thead><tr><th>Scenario</th><th>Runs</th><th>Verified success</th><th>False completion</th><th>Median time*</th><th>Tokens / success</th>${stageHeads}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="metrics-note">A run is one full ${stages.length}-stage journey; <b>verified success</b> = every live-instance check passed. <b>False completion</b> = the agent finished cleanly but a check failed. *Median time excludes time waiting on the developer's answers. S1–S${stages.length} show how many repeats passed each stage.</p>`;
}

const tabButtons = (stages: ReadonlyArray<Stage>): string =>
  stages
    .map(
      (stage, index) =>
        `<button class="tab" role="tab" id="tab-${stage.id}" aria-controls="stage-${stage.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" onclick="show(${stage.id})">Stage ${stage.id}</button>`,
    )
    .join("");

/** One stage's panel: each scenario's first repeat, expanded for the skill runs. */
function stagePanel({ groups }: ReportData, stage: Stage, index: number): string {
  const details = groups
    .map((group) => {
      const row = group.cells[0]?.rows.find((candidate) => candidate.stage === stage.id);
      if (row === undefined) {
        return "";
      }
      const time = row.ms > 0 ? ` · ${duration(row.ms)}` : "";
      const open = group.config === "with-skill" ? " open" : "";
      return `<details class="cfg"${open}><summary>${badge(row.status)}<span class="cfg-name">${escapeHtml(scenarioLabel(group))}</span><span class="why">${escapeHtml(row.why)}</span><span class="stat">${tally(row.parsed, row.turns)} · ${row.tokens.toLocaleString()} tokens${time}</span></summary><div class="body">${checksBlock(row.asserts)}${timingBlock(row.parsed)}${conversation(stage.prompt, row.parsed.transcript)}</div></details>`;
    })
    .join("");
  return `<section class="stage-panel" role="tabpanel" id="stage-${stage.id}" aria-labelledby="tab-${stage.id}" tabindex="0"${index === 0 ? "" : " hidden"}><h2 class="stage-head">Stage ${stage.id}: ${escapeHtml(stage.title)}</h2>${details}</section>`;
}

/** The self-contained report: everything inlined, so the file opens from disk or can be shared as is. */
export function renderReport(data: ReportData): string {
  const { stages, meta } = data;
  const subtitle = `One stateful run per config; the same project flows through ${stages.length} stages. Each stage shows the full conversation — the prompt, what the agent asked, what the user answered, and every command with its real output.`;
  const footerExtra = `<div><dt>Node</dt><dd>${escapeHtml(meta.node)}</dd></div><div><dt>User model</dt><dd>${escapeHtml(meta.simModel)}</dd></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="cli-skill-e2e report">
<title>zitadel-cli ${escapeHtml(data.journey)} eval</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header class="banner">
  <h1>zitadel-cli skill — ${escapeHtml(data.journey)} journey eval</h1>
  <p class="sub">${escapeHtml(subtitle)}</p>
  <div class="scoreboard">${scoreboard(data)}</div>
  ${metadataList(data)}
</header>
<section class="metrics-wrap" aria-label="Metrics">${metricsTable(data)}</section>
<nav class="tabs" role="tablist" aria-label="Journey stages">${tabButtons(stages)}</nav>
<main>${stages.map((stage, index) => stagePanel(data, stage, index)).join("")}</main>
<footer class="site-foot">
  <p>zitadel-cli agent-skill eval. The agent drives the CLI non-interactively; a simulated user answers its questions.</p>
  ${metadataList(data, footerExtra)}
</footer>
<script>${clientScript(stages[0]?.id ?? 1)}</script>
</body>
</html>`;
}
