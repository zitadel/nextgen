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

/**
 * A spinner drawn in the chain's gutter. `guide: false` keeps it out of the
 * gutter, for a probe that clears itself: a cleared spinner that drew a guide
 * line leaves that line behind.
 */
export class DrawnSpinner implements Spinner {
  /** The spinners that are drawing now, so a line written meanwhile can make room (read by the tests, which clear it). */
  static readonly active = new Set<DrawnSpinner>();

  private handle: ReturnType<typeof spinner>;
  private text: string;
  private readonly guide: boolean;
  private readonly input: { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };

  /**
   * @param label - What the work is.
   * @param guide - Whether the spinner sits in the chain's gutter.
   * @param input - The terminal Ctrl-C is read from. Clack's spinner switches it
   *   to raw mode, where Ctrl-C arrives as a key and clack answers it with
   *   `process.exit(0)`: no `E_CANCELLED`, no rollback, and an exit status that
   *   says the run succeeded. Raw mode is switched off again, so Ctrl-C is the
   *   signal the command's own handler turns into a cancellation.
   */
  constructor(
    label: string,
    guide = true,
    input: { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown } = process.stdin,
  ) {
    this.text = label;
    this.guide = guide;
    this.input = input;
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
    const running = [...DrawnSpinner.active];
    for (const one of running) {
      one.handle.clear();
    }
    write();
    for (const one of running) {
      one.handle = one.spin();
    }
  }

  message(text: string): void {
    this.text = text;
    this.handle.message(text);
  }

  stop(text?: string): void {
    DrawnSpinner.active.delete(this);
    this.handle.stop(text);
  }

  clear(): void {
    DrawnSpinner.active.delete(this);
    this.handle.clear();
  }

  /** Starts clack's spinner under the current text, with Ctrl-C left as a signal. */
  private spin(): ReturnType<typeof spinner> {
    const handle = spinner({ withGuide: this.guide });
    handle.start(this.text);
    if (this.input.isTTY === true) {
      this.input.setRawMode?.(false);
    }
    return handle;
  }
}
