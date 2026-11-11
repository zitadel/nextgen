import { format } from "node:util";

import { writePlain } from "./ui/plain";

/**
 * What a line of narration is. The level decides the mark it carries in a
 * wizard's chain; a normal command draws every level as a plain line.
 */
export type LogLevel = "info" | "done" | "start" | "warn" | "fail" | "plain" | "debug";

/** Whatever draws a command's narration: the UI the base command hands it to. */
export type LogSink = (level: LogLevel, text: string) => void;

let sink: LogSink | undefined;

function emit(level: LogLevel, args: readonly unknown[]): void {
  const text = format(...args);
  if (sink !== undefined) {
    sink(level, text);
    return;
  }
  // Nothing is drawing: code that runs outside a command, such as the root help
  // page, still has to be heard. `--json` is silent because it installs a sink
  // that draws nothing, not because there is none.
  if (level !== "debug") {
    writePlain(level, text);
  }
}

/**
 * Installs the sink that draws narration, until the returned function is
 * called. The base command installs one for the length of a command, because
 * a process-wide logger left installed would keep drawing into a command that
 * has ended; the unit tests rely on that, since every command in them shares
 * one process.
 *
 * @param next - Where narration goes while it is installed.
 * @returns A function that puts back whatever was installed before.
 */
export function installLogSink(next: LogSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/**
 * The one way the CLI says what it is doing, from a command or a library alike.
 *
 * It names no look: the sink installed by the running command decides whether
 * a line is a chain line with its mark, a plain line, or nothing at all
 * (`--json` installs a sink that draws nothing). Code that logs therefore never
 * needs to know which kind of command it is running under, or be handed the UI
 * to talk to. With no sink installed, a line is written plainly.
 */
export const log = {
  /** A statement of fact: what was found, or where a command is pointed. */
  info: (...args: unknown[]) => {
    emit("info", args);
  },
  /** Something finished. */
  done: (...args: unknown[]) => {
    emit("done", args);
  },
  /** Work that has begun, and will report how it ended. */
  start: (...args: unknown[]) => {
    emit("start", args);
  },
  /** Something that worked but wants a look. Use `reportWarning` to warn. */
  warn: (...args: unknown[]) => {
    emit("warn", args);
  },
  /** Something failed. The error itself is said by the ending. */
  fail: (...args: unknown[]) => {
    emit("fail", args);
  },
  /** A line with no mark of its own, such as a link or a pasted diff. */
  plain: (...args: unknown[]) => {
    emit("plain", args);
  },
  /** Detail nobody asked for, shown only under `--debug`. */
  debug: (...args: unknown[]) => {
    emit("debug", args);
  },
};
