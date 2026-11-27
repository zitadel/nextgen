import pc from "picocolors";

import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * The CLI's palette, named for what the text is rather than the color it gets,
 * so one kind of thing looks the same in every command. `picocolors` decides
 * whether color is on, so `--no-color`, `NO_COLOR` and piped output all stay
 * plain. Style human output through this, not `picocolors` directly.
 *
 * Each method spells out what it is given, as a table's cells are spelled out
 * where they are read: a fragment from here goes into a painted rendering,
 * which the base command prints as it came so the colour survives, so the
 * value has to be safe before it gets there. That holds for the plain ones
 * too. An id, a path, a version read from a registry and a server's own
 * message all arrive here, and none of them may drive the reader's terminal.
 */
class Style {
  /** The color of each outcome, for a mark in another shape, like doctor's `[✓]`. */
  readonly statusColor = { pass: pc.green, warn: pc.yellow, fail: pc.red } as const;

  /** The mark for each outcome, in front of a line that reports one. */
  readonly mark = {
    pass: this.statusColor.pass("✓"),
    warn: this.statusColor.warn("!"),
    fail: this.statusColor.fail("✗"),
  } as const;

  /** Between a thing and what it leads to: a package and its file, a problem and its fix. */
  readonly arrow = pc.dim("→");

  /**
   * Bold cyan, for commands the user should run.
   *
   * @param s - The command.
   * @returns The command, spelled out and painted.
   */
  command(s: string): string {
    return pc.bold(pc.cyan(this.text(s)));
  }

  /**
   * Cyan, for filesystem paths the user can open.
   *
   * @param s - The path.
   * @returns The path, spelled out and painted.
   */
  path(s: string): string {
    return pc.cyan(this.text(s));
  }

  /**
   * Cyan, for a frame that says what to read or do, as against green for what
   * succeeded.
   *
   * @param s - The frame's text, already safe.
   * @returns The text, painted.
   */
  notice(s: string): string {
    return pc.cyan(s);
  }

  /**
   * Cyan, for URLs (browser-clickable in most terminals).
   *
   * @param s - The URL.
   * @returns The URL, spelled out and painted.
   */
  url(s: string): string {
    return pc.cyan(this.text(s));
  }

  /**
   * Plain, for opaque ids: there is nothing to open, and yellow means a
   * warning. Still spelled out, because an id the server minted is
   * interpolated into a rendering printed as it came, whether or not this
   * colours it.
   *
   * @param s - The id.
   * @returns The id, spelled out.
   */
  id(s: string): string {
    return this.text(s);
  }

  /**
   * Dim, for separators and secondary detail.
   *
   * @param s - The detail.
   * @returns The detail, spelled out and dimmed.
   */
  dim(s: string): string {
    return pc.dim(this.text(s));
  }

  /**
   * Bold, for titles and what needs attention.
   *
   * @param s - The title.
   * @returns The title, spelled out and bold.
   */
  strong(s: string): string {
    return pc.bold(this.text(s));
  }

  /**
   * What a fragment carries: text, never an escape sequence.
   *
   * @param s - The fragment.
   * @returns The fragment with its control characters spelled out.
   */
  private text(s: string): string {
    return escapeControlCharacters(s);
  }
}

/** The one palette every command and library paints with. */
export const style = new Style();
