import { format } from "node:util";

import { writePlain } from "./plain";

/**
 * What a line of narration is. Only `warn` and `fail` are written when stdout is
 * not a terminal; `debug` is shown under `--debug`, on stderr off a terminal. A
 * wizard's chain marks an `info` line as a status, and a block of text without
 * a mark; a normal command draws every level as a plain line.
 */
export type LogLevel = "info" | "warn" | "fail" | "debug";

/** Whatever draws a command's narration: the UI the base command hands it to. */
export type LogSink = (level: LogLevel, text: string) => void;

/**
 * The one way the CLI says what it is doing, from a command or a library alike.
 *
 * It names no look: the sink installed by the running command decides whether
 * a line is a chain line with its mark, a plain line, or nothing at all
 * (`--json` installs a sink that draws nothing, and a pipe is given only `warn`
 * and `fail`). Code that logs therefore never needs to know which kind of
 * command it is running under, or be handed the UI to talk to. With no sink
 * installed, a line is written plainly.
 *
 * The CLI runs one command per process, so one instance ({@link log}) serves
 * every library that has no `Ui` at hand.
 */
export class Log {
  /** Every sink still installed, oldest first; the newest draws. */
  private readonly sinks: Array<{ draw: LogSink }> = [];

  /**
   * A statement of fact: what was found, or where a command is pointed.
   *
   * @param args - What to say, formatted the way `console` formats it.
   */
  info(...args: unknown[]): void {
    this.emit("info", args);
  }

  /**
   * Something that worked but wants a look. Use `warnings.report` to warn.
   *
   * @param args - What to say, formatted the way `console` formats it.
   */
  warn(...args: unknown[]): void {
    this.emit("warn", args);
  }

  /**
   * Something failed. The error itself is said by the ending.
   *
   * @param args - What to say, formatted the way `console` formats it.
   */
  fail(...args: unknown[]): void {
    this.emit("fail", args);
  }

  /**
   * Detail nobody asked for, shown only under `--debug`.
   *
   * @param args - What to say, formatted the way `console` formats it.
   */
  debug(...args: unknown[]): void {
    this.emit("debug", args);
  }

  /**
   * Installs the sink that draws narration, until the returned function is
   * called. The base command installs one for the length of a command, because
   * a process-wide logger left installed would keep drawing into a command that
   * has ended; the unit tests rely on that, since every command in them shares
   * one process.
   *
   * @param next - Where narration goes while it is installed.
   * @returns A function that removes this sink, whatever order sinks are removed
   *   in, so one that has ended is never drawn into again.
   */
  install(next: LogSink): () => void {
    const installed = { draw: next };
    this.sinks.push(installed);
    return () => {
      const at = this.sinks.indexOf(installed);
      if (at !== -1) {
        this.sinks.splice(at, 1);
      }
    };
  }

  /**
   * Hands one line to the newest sink, or writes it plainly when there is none.
   *
   * @param level - What the line is.
   * @param args - What was said.
   */
  private emit(level: LogLevel, args: readonly unknown[]): void {
    const text = format(...args);
    const sink = this.sinks.at(-1);
    if (sink !== undefined) {
      sink.draw(level, text);
      return;
    }
    if (level !== "debug") {
      writePlain(level, text);
    }
  }
}

/** The process-wide narration every command and library says things with. */
export const log = new Log();
