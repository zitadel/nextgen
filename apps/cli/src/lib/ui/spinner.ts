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
  private readonly handle: ReturnType<typeof spinner>;

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
    this.handle = spinner({ withGuide: guide });
    this.handle.start(label);
    if (input.isTTY === true) {
      input.setRawMode?.(false);
    }
  }

  message(text: string): void {
    this.handle.message(text);
  }

  stop(text?: string): void {
    this.handle.stop(text);
  }

  clear(): void {
    this.handle.clear();
  }
}
