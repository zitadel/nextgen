import pc from "picocolors";

import { escapeControlCharacters } from "../api-client";
import { isObject } from "../json";

/** The levels `zitadel logs --level` takes, lowest first. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * One line of the server's log and the level of the record it belongs to: its
 * own, or, for a line that is not a record (a panic's stack trace), that of the
 * record above it. `undefined` for a line with no record above it.
 */
export type LogLine = Readonly<{ text: string; level: LogLevel | undefined }>;

/**
 * Where a launcher hands the log it reads while following it: first the log as
 * it is, then each part written after it. A part can end inside a line.
 */
export type LogSink = Readonly<{
  existing: (text: string) => void;
  appended: (text: string) => void;
}>;

/**
 * The level names the server writes, in each of its formats. slog writes a
 * level between two named ones as the lower name and an offset (`INFO+2`,
 * `ERROR+4`), which is read as that name; the GCP format writes Cloud
 * Logging's severities.
 */
const LEVEL_NAMES: Readonly<Record<string, LogLevel>> = {
  DEBUG: "debug",
  INFO: "info",
  NOTICE: "info",
  WARN: "warn",
  WARNING: "warn",
  ERROR: "error",
  CRITICAL: "error",
  ALERT: "error",
  EMERGENCY: "error",
};

/** A record in slog's text format, the server's default: `time=… level=WARN …`. */
const TEXT_RECORD = /^(?:time=\S+ )?level=([A-Z]+)(?:[+-]\d+)?(?: |$)/;

/**
 * A record Go's default logger writes, which the server logs through until it
 * has set up its own: `2026/10/22 07:58:44 WARN …`.
 */
const DEFAULT_RECORD = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? ([A-Z]+)(?:[+-]\d+)? /;

/** What the Go runtime prints, outside any logger, when the server crashes. */
const CRASH = /^(?:panic|fatal error): /;

/**
 * The level a line of the server's log was written at, or `undefined` for a
 * line that is not a log record. Reads slog's text format, its JSON format
 * (`instrumentation.log.format: json`, and `gcp`, which says `severity`), the
 * lines Go's default logger writes before the server's own is set up, and a
 * crash, which counts as an error.
 */
export function levelOf(text: string): LogLevel | undefined {
  const name = TEXT_RECORD.exec(text)?.[1] ?? DEFAULT_RECORD.exec(text)?.[1] ?? jsonLevel(text);
  if (name !== undefined) {
    return LEVEL_NAMES[name];
  }
  return CRASH.test(text) ? "error" : undefined;
}

function jsonLevel(text: string): string | undefined {
  if (!text.startsWith("{")) {
    return undefined;
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return undefined;
  }
  const level = isObject(record) ? (record.level ?? record.severity) : undefined;
  return typeof level === "string" ? level.replace(/[+-]\d+$/, "") : undefined;
}

/**
 * Splits the server's log into lines as it is read, in parts that need not end
 * at a line break: a line one part starts waits for the part that ends it. A
 * line that is not a record takes the level of the record above it, so a
 * panic's stack trace is shown, colored and filtered with the panic.
 */
export class LogLineReader {
  private partial = "";
  private level: LogLevel | undefined;

  /** The lines `part` completes. */
  read(part: string): LogLine[] {
    const pieces = `${this.partial}${part}`.split("\n");
    this.partial = pieces.pop() ?? "";
    return pieces.map((piece) => this.line(piece));
  }

  /** The last line, when the log does not end with a line break. */
  end(): LogLine[] {
    const rest = this.partial;
    this.partial = "";
    return rest === "" ? [] : [this.line(rest)];
  }

  private line(piece: string): LogLine {
    const text = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    this.level = levelOf(text) ?? this.level;
    return { text, level: this.level };
  }
}

/** The lines of a whole log, levelled as {@link LogLineReader} levels them. */
export function logLines(text: string): LogLine[] {
  const reader = new LogLineReader();
  return [...reader.read(text), ...reader.end()];
}

/** The lines at `level` or above; all of them without a level. A line with no level is below every level. */
export function atLeast(lines: readonly LogLine[], level: LogLevel | undefined): LogLine[] {
  if (level === undefined) {
    return [...lines];
  }
  const floor = LOG_LEVELS.indexOf(level);
  return lines.filter(
    (line) => line.level !== undefined && LOG_LEVELS.indexOf(line.level) >= floor,
  );
}

/** The last `tail` lines, counting only those at `level` or above when a level is given. */
export function lastLines(
  lines: readonly LogLine[],
  tail: number,
  level: LogLevel | undefined,
): LogLine[] {
  return atLeast(lines, level).slice(-tail);
}

/** The lines as the log has them, each ending with a line break. */
export function logText(lines: readonly LogLine[]): string {
  return lines.map((line) => `${line.text}\n`).join("");
}

const paint = pc.createColors(true);

/**
 * A line as `zitadel logs` prints it for a person. Characters that could drive
 * the terminal are escaped, as everywhere the CLI prints text it did not write.
 * With `color`, a warning is yellow and an error red, so they stand out from the
 * requests that make up most of the log, and a debug line is dimmed.
 */
export function renderLogLine(line: LogLine, color: boolean): string {
  const text = escapeControlCharacters(line.text);
  if (!color) {
    return text;
  }
  switch (line.level) {
    case "error":
      return paint.red(text);
    case "warn":
      return paint.yellow(text);
    case "debug":
      return paint.dim(text);
    default:
      return text;
  }
}
