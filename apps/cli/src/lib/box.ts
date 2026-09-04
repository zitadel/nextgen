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
  return wrapAnsi(message, width, { hard: false, trim: false });
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
