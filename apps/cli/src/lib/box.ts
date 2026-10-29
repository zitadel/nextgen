import consola from "consola";
import { box } from "consola/utils";
import pc from "picocolors";
import wrapAnsi from "wrap-ansi";

/**
 * Frame overhead of a `consola.box` with `padding: 1`: two border columns,
 * the padding columns, and consola's left margin. Content wrapped to the
 * terminal width minus this stays inside the frame instead of soft-wrapping
 * under the right border.
 */
const BOX_OVERHEAD = 8;
const MIN_CONTENT_WIDTH = 20;
const MAX_TERMINAL_WIDTH = 80;

/** Bold cyan, for commands the user should run (URLs/paths stay plain cyan). */
export const command = (s: string): string => pc.bold(pc.cyan(s));

/**
 * Wraps box content to the terminal (capped at 80 columns) so consola's
 * frame, which sizes itself to the longest content line, never exceeds the
 * window. ANSI-aware, preserves hard line breaks and indentation, and never
 * splits a token: URLs and commands stay whole for clicking, copying, and the
 * journey e2e scrape (claim.spec.ts), even when such a token alone is wider
 * than a very narrow window.
 */
export function wrapForBox(message: string, columns = process.stdout.columns): string {
  const width = Math.max(
    MIN_CONTENT_WIDTH,
    Math.min(columns ?? MAX_TERMINAL_WIDTH, MAX_TERMINAL_WIDTH) - BOX_OVERHEAD,
  );
  return message
    .split("\n")
    .map((line) => wrapLineHanging(line, width))
    .join("\n");
}

/**
 * Wrap one line to `width`, hanging the continuation under the text after a
 * leading list marker ("  • ", "  1. ") or the line's own indentation, so a
 * sentence too long for the box reads as one item rather than spilling back to
 * the left border. A line with neither marker nor indent wraps as a plain
 * paragraph. Tokens are never split, so URLs and commands stay whole.
 */
function wrapLineHanging(line: string, width: number): string {
  const prefix = (line.match(/^(\s*(?:•|\d+[.)])\s+)/) ?? line.match(/^(\s*)/))?.[1] ?? "";
  const content = line.slice(prefix.length);
  if (content === "") {
    return line;
  }
  // Wrap the text after the marker to what is left of the width, so the marker
  // plus a wrapped line never runs past the frame. At a pathologically narrow
  // width a long token still overflows, exactly as a plain wrap would.
  const avail = Math.max(1, width - prefix.length);
  const pad = " ".repeat(prefix.length);
  return wrapAnsi(content, avail, { hard: false, trim: true })
    .split("\n")
    .map((part, at) => (at === 0 ? prefix : pad) + part)
    .join("\n");
}

/**
 * A next-step line for the human box: prose plus, when the step is literally
 * a command to run, that command pulled out of the sentence. The JSON
 * envelope keeps its own plain `next_actions`/`next_commands` strings; this
 * shape exists only so {@link renderBoxActions} can put the command alone on
 * an indented styled line, where it stands out and a drag-select copies it
 * without surrounding prose. (Line selection such as triple-click still
 * includes the box border and padding — commands that must copy as a whole
 * physical line belong outside a frame, like the claim URL.)
 */
export type BoxAction = { text: string; command?: string };

export function renderBoxActions(actions: BoxAction[]): string {
  return actions
    .map((action) =>
      action.command ? `${action.text}\n\n  ${command(action.command)}` : action.text,
    )
    .join("\n\n");
}

/** What a box means, and so its colour: `success` for a result, `info` for a hint. */
export type BoxTone = "success" | "info";

const BORDER = { success: "green", info: "cyan" } as const;

export type BoxOptions = {
  readonly title: string;
  /** The content as written: it is wrapped to the terminal here, so do not wrap it first. */
  readonly message: string;
  /** Defaults to `success`. */
  readonly tone?: BoxTone;
};

function frame({ title, tone = "success" }: BoxOptions) {
  return {
    title,
    style: { padding: 1, borderStyle: "rounded", borderColor: BORDER[tone] },
  } as const;
}

/**
 * A rounded, padded frame around a message, as a string. Every box the CLI
 * draws goes through here, so its look and its wrapping to the terminal are
 * decided once. Use this where output is returned (a command's `pretty`), and
 * {@link printBox} where it is logged.
 */
export function renderBox(options: BoxOptions): string {
  return box(wrapForBox(options.message), frame(options));
}

/**
 * Log a box with consola, so it follows the same log level and `--json`
 * silence as every message. Rendered through {@link renderBox} rather than
 * `consola.box` so the rounded frame is drawn the same way everywhere: consola
 * only draws it when attached to an interactive terminal and degrades to
 * ` > ` lines otherwise (a pipe, a CI log, a captured run), which is the one
 * place the box should still read as a box.
 */
export function printBox(options: BoxOptions): void {
  consola.log(renderBox(options));
}
