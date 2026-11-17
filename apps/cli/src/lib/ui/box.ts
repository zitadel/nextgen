import wrapAnsi from "wrap-ansi";

/**
 * A next-step line for the human box: prose plus, when the step is literally
 * a command to run, that command pulled out of the sentence. The JSON
 * envelope keeps its own plain `next_actions`/`next_commands` strings; this
 * shape exists only so the summary's frame can put the command alone on
 * an indented styled line, where it stands out and a drag-select copies it
 * without surrounding prose. (Line selection such as triple-click still
 * includes the box border and padding — commands that must copy as a whole
 * physical line belong outside a frame, like the claim URL.)
 */
export type BoxAction = { text: string; command?: string };

/** The frame a summary and a notice are drawn in, as wide as the terminal allows. */
export class Box {
  /**
   * Frame overhead of a box with a column of padding: two border columns,
   * the padding columns, and the left margin. Content wrapped to the
   * terminal width minus this stays inside the frame instead of soft-wrapping
   * under the right border.
   */
  private static readonly OVERHEAD = 8;
  private static readonly MIN_CONTENT_WIDTH = 20;
  private static readonly MAX_TERMINAL_WIDTH = 80;

  private readonly width: number;

  private constructor(columns: number | undefined) {
    this.width = Math.max(
      Box.MIN_CONTENT_WIDTH,
      Math.min(columns || Box.MAX_TERMINAL_WIDTH, Box.MAX_TERMINAL_WIDTH) - Box.OVERHEAD,
    );
  }

  /**
   * The box for a terminal.
   *
   * @param columns - The terminal's width. Defaults to stdout's.
   * @returns The box, capped at 80 columns.
   */
  static at(columns: number | undefined = process.stdout.columns): Box {
    return new Box(columns);
  }

  /**
   * Wraps box content to the terminal so the frame, which sizes itself to the
   * longest content line, never exceeds the window. ANSI-aware, preserves hard
   * line breaks and indentation, and never splits a token: URLs and commands
   * stay whole for clicking, copying, and the journey e2e scrape
   * (claim.spec.ts), even when such a token alone is wider than a very narrow
   * window.
   *
   * @param message - The content to wrap.
   * @returns The content, wrapped to fit inside the frame.
   */
  wrap(message: string): string {
    return wrapAnsi(message, this.width, { hard: false, trim: false });
  }
}
