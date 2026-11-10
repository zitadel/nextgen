import type { Status } from "../grading.ts";
import type { CommandEntry, FileEntry } from "../transcript.ts";
import { markdownToHtml } from "./markdown.ts";

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);

/** Server-side fallback text; the viewer's browser re-formats it with Intl. */
const fallbackDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours > 0 ? `${hours}h ` : ""}${minutes > 0 ? `${minutes}m ` : ""}${seconds % 60}s`;
};

export const duration = (ms: number | null | undefined): string =>
  ms ? `<span class="dur" data-ms="${ms}">${escapeHtml(fallbackDuration(ms))}</span>` : "";

export const timestamp = (iso: string): string =>
  `<time class="ts" datetime="${escapeHtml(iso)}" data-iso="${escapeHtml(iso)}">${escapeHtml(iso)}</time>`;

/** A short time: whole seconds from a second up, milliseconds below, so a fast command is not shown as 0s. */
export const took = (ms: number | null | undefined): string =>
  ms == null ? "" : ms >= 1000 ? duration(ms) : `${ms}\u00a0ms`;

const BADGES: Readonly<Record<Status, readonly [string, string]>> = {
  pass: ["ok", "Pass"],
  fail: ["no", "Fail"],
  blocked: ["bl", "Blocked"],
  skipped: ["bl", "Skipped"],
};

export const badge = (status: Status): string => {
  const [tone, label] = BADGES[status] ?? ["no", "?"];
  return `<span class="b ${tone}" role="status">${label}</span>`;
};

const MAX_OUTPUT = 2500;

export function commandBlock(entry: CommandEntry): string {
  const command = escapeHtml(entry.cmd.replace(/\s+/g, " ").trim());
  const output = entry.out === "" ? "(no output captured)" : entry.out;
  const shown =
    output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n… (truncated)` : output;
  // A command that never reported back (a killed turn) has an unknown outcome,
  // which is neither the green of a success nor the red of a failure.
  const known = entry.exit !== undefined;
  const code =
    entry.exit === 0
      ? "exit 0"
      : entry.exit != null
        ? `exit ${entry.exit}`
        : known
          ? "exit ≠ 0"
          : "no result";
  const tone = entry.err ? "err" : known ? "ok" : "unk";
  const ran =
    entry.ran == null
      ? ""
      : `<span class="took" title="how long the command ran">ran ${took(entry.ran)}</span>`;
  const thought =
    entry.thought == null
      ? ""
      : `<span class="took think" title="model time before issuing the command">model ${took(entry.thought)}</span>`;
  return `<div class="cmd ${tone}"><div class="c"><code>${command}</code>${thought}${ran}<span class="exit ${tone}">${escapeHtml(code)}</span></div><pre class="o">${escapeHtml(shown)}</pre></div>`;
}

/** A file the agent changed with its own editing tools. */
export function fileBlock(entry: FileEntry): string {
  const thought =
    entry.thought == null
      ? ""
      : `<span class="took think" title="model time before the edit">model ${took(entry.thought)}</span>`;
  return `<div class="cmd file"><div class="c"><code>${escapeHtml(entry.tool)} ${escapeHtml(entry.path)}</code>${thought}</div></div>`;
}

export function bubble(
  kind: "prompt" | "agent" | "answer",
  label: string,
  text: string,
  ms?: number | null,
): string {
  const time = ms ? `<span class="turn-time" title="agent turn time">${duration(ms)}</span>` : "";
  return `<div class="msg ${kind}"><div class="lbl">${escapeHtml(label)}${time}</div><div class="md">${markdownToHtml(text)}</div></div>`;
}
