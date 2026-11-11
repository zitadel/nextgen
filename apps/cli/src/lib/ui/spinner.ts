import type { EventEmitter } from "node:events";
import type { Writable } from "node:stream";

import { spinner } from "@clack/prompts";

/**
 * A spinner the caller drives itself: it runs while something takes a moment
 * and is then either replaced by a line that says how it ended, or cleared,
 * leaving nothing behind.
 *
 * Prefer `this.ui.task(...)`, which cannot be left spinning. This is for work
 * the surrounding code cannot wrap in a callback: a probe whose result is the
 * options of the next question, or a page loop that renames itself as it goes.
 *
 * Nothing here decides for itself whether to draw. A {@link QuietSpinner} is
 * handed out when nobody is watching, so a caller never has to write
 * `isTTY && !json` again — and so a `--json` run cannot animate over its
 * envelope.
 */
export interface Spinner {
  /** Renames the spinner while it runs: `Fetching users — page 3`. */
  message(text: string): void;
  /** Stops it and leaves `text` (or the label it started with) as one line. */
  stop(text?: string): void;
  /** Stops it and leaves nothing behind, for work whose result speaks for itself. */
  clear(): void;
}

/** A spinner for nobody: every call is a no-op, so no caller has to check. */
export class QuietSpinner implements Spinner {
  message(): void {}
  stop(): void {}
  clear(): void {}
}

/** The terminal a spinner reads keys from: a TTY switched to raw mode while it draws. */
export type SpinnerInput = EventEmitter & { isTTY?: boolean };

/** The terminal a spinner draws on. */
export type SpinnerOutput = Writable & { isTTY?: boolean };

/** Ctrl-C as a raw-mode terminal sends it: a key, not a signal. */
const CTRL_C = "\u0003";

/**
 * A spinner drawn in the chain's gutter. `guide: false` keeps it out of the
 * gutter, for a probe that clears itself: a cleared spinner that drew a guide
 * line leaves that line behind.
 */
export class DrawnSpinner implements Spinner {
  /** The spinners that are drawing now, so a line written meanwhile can make room (read by the tests, which clear it). */
  static readonly active = new Set<DrawnSpinner>();

  private static exitHooked = false;

  private handle: ReturnType<typeof spinner>;
  private text: string;
  private readonly guide: boolean;
  private readonly input: SpinnerInput;
  private readonly output: SpinnerOutput;

  /**
   * @param label - What the work is.
   * @param guide - Whether the spinner sits in the chain's gutter.
   * @param input - The terminal keys are read from. Clack's spinner switches it
   *   to raw mode, so a key pressed meanwhile is not echoed over the frame, and
   *   answers Ctrl-C there with `process.exit(0)`: no `E_CANCELLED`, no
   *   rollback, and an exit status that says the run succeeded. Raw mode is
   *   kept, clack's key handling is taken off, and Ctrl-C is raised as the
   *   SIGINT the command's own handler turns into a cancellation.
   * @param output - The terminal the spinner is drawn on.
   */
  constructor(
    label: string,
    guide = true,
    input: SpinnerInput = process.stdin,
    output: SpinnerOutput = process.stdout,
  ) {
    this.text = label;
    this.guide = guide;
    this.input = input;
    this.output = output;
    this.handle = this.spin();
    DrawnSpinner.active.add(this);
  }

  /**
   * Write something while a spinner may be drawing. Clack redraws its frame in
   * place, so a line written under it is glued to the frame or erased by the
   * next tick: the spinner is cleared first and drawn again below the line.
   *
   * @param write - Writes the line.
   */
  static around(write: () => void): void {
    const resume = DrawnSpinner.pause();
    write();
    resume();
  }

  /**
   * Clears every running spinner, for a prompt that is about to be drawn: a
   * spinner left drawing would write over it.
   *
   * @returns Draws the cleared spinners again, once the prompt is answered.
   */
  static pause(): () => void {
    const running = [...DrawnSpinner.active];
    for (const one of running) {
      one.release();
      one.eraseGuide();
    }
    return () => {
      // A spinner stopped or cleared while paused stays stopped.
      for (const one of running) {
        if (DrawnSpinner.active.has(one)) {
          one.handle = one.spin();
        }
      }
    };
  }

  /** Stops every spinner still drawing, so what ends a run is not drawn over. */
  static clearAll(): void {
    for (const one of [...DrawnSpinner.active]) {
      one.clear();
    }
  }

  message(text: string): void {
    this.text = text;
    this.handle.message(text);
  }

  stop(text?: string): void {
    DrawnSpinner.active.delete(this);
    this.input.off("data", this.onKeys);
    this.handle.stop(text);
  }

  clear(): void {
    DrawnSpinner.active.delete(this);
    this.release();
  }

  /** Clears the frame and stops reading keys, leaving the guide line it drew. */
  private release(): void {
    this.input.off("data", this.onKeys);
    this.handle.clear();
  }

  /**
   * Erases the guide line {@link spin} drew above the frame, which clearing
   * the frame leaves behind: without this, every pause and resume would add
   * one more empty guide line to the chain.
   */
  private eraseGuide(): void {
    if (this.guide && this.output.isTTY === true) {
      // Up one line, then erase from there down.
      this.output.write("\u001b[1A\u001b[0J");
    }
  }

  /**
   * Raises Ctrl-C, which a raw-mode terminal sends as a key, as the SIGINT it
   * would have been: to the command's handler when there is one, or to the
   * process, which Node then ends as a shell expects.
   *
   * @param chunk - What the terminal sent.
   */
  private readonly onKeys = (chunk: Buffer | string): void => {
    if (!String(chunk).includes(CTRL_C)) {
      return;
    }
    if (process.listenerCount("SIGINT") > 0) {
      process.emit("SIGINT", "SIGINT");
      return;
    }
    process.kill(process.pid, "SIGINT");
  };

  /**
   * Starts clack's spinner under the current text, with Ctrl-C raised as a
   * signal.
   *
   * @returns Clack's handle on the spinner it started.
   */
  private spin(): ReturnType<typeof spinner> {
    const events = ["SIGINT", "SIGTERM", "exit", "uncaughtExceptionMonitor", "unhandledRejection"];
    const before = events.map((event) => {
      return {
        event,
        listeners: new Set(process.listeners(event as NodeJS.Signals)),
      };
    });
    const keys = new Set(this.input.listeners("keypress"));
    const handle = spinner({ withGuide: this.guide, output: this.output });
    handle.start(this.text);
    // Clack's own handlers print "Canceled" or an error line of theirs; the
    // command's single `Cancelled` ending is the only one wanted.
    for (const { event, listeners } of before) {
      for (const listener of process.listeners(event as NodeJS.Signals)) {
        if (!listeners.has(listener)) {
          process.removeListener(event, listener);
        }
      }
    }
    if (!DrawnSpinner.exitHooked) {
      DrawnSpinner.exitHooked = true;
      process.once("exit", () => {
        DrawnSpinner.clearAll();
      });
      // Clack's SIGTERM handler is removed above, so this restores the cursor
      // and ends the run as Node would have, unless another handler owns it.
      process.once("SIGTERM", () => {
        DrawnSpinner.clearAll();
        if (process.listenerCount("SIGTERM") === 0) {
          process.kill(process.pid, "SIGTERM");
        }
      });
    }
    if (this.input.isTTY === true) {
      // Clack's key handler exits 0 on Ctrl-C, and its line editor would echo
      // what it reads; raw mode stays on, so the terminal echoes nothing either.
      for (const listener of this.input.listeners("keypress")) {
        if (!keys.has(listener)) {
          this.input.removeListener("keypress", listener as (...args: unknown[]) => void);
        }
      }
      this.input.off("data", this.onKeys);
      this.input.on("data", this.onKeys);
    }
    return handle;
  }
}
