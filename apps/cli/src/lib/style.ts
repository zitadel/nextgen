import pc from "picocolors";

import { escapeControlCharacters } from "./terminal-text";

/**
 * The CLI's palette, named for what the text is rather than the color it gets,
 * so one kind of thing looks the same in every command. `picocolors` decides
 * whether color is on, so `--no-color`, `NO_COLOR` and piped output all stay
 * plain. Style human output through these, not `picocolors` directly.
 *
 * Each one spells out what it is given, as a table's cells are spelled out
 * where they are read: a fragment from here goes into a painted rendering,
 * which the base command prints as it came so the colour survives, so the
 * value has to be safe before it gets there. That holds for the plain ones
 * too. An id, a path, a version read from a registry and a server's own
 * message all arrive here, and none of them may drive the reader's terminal.
 */

/** What a fragment carries: text, never an escape sequence. */
const text = (s: string): string => escapeControlCharacters(s);

/** Bold cyan, for commands the user should run. */
export const command = (s: string): string => pc.bold(pc.cyan(text(s)));
/** Cyan, for filesystem paths the user can open. */
export const path = (s: string): string => pc.cyan(text(s));
/** Cyan, for a frame that says what to read or do, as against green for what succeeded. */
export const notice = (s: string): string => {
  return pc.cyan(s);
};
/** Cyan, for URLs (browser-clickable in most terminals). */
export const url = (s: string): string => pc.cyan(text(s));
/**
 * Plain, for opaque ids: there is nothing to open, and yellow means a warning.
 * Still spelled out, because an id the server minted is interpolated into a
 * rendering printed as it came, whether or not this colours it.
 */
export const id = (s: string): string => text(s);
/** Dim, for separators and secondary detail. */
export const dim = (s: string): string => pc.dim(text(s));
/** Bold, for titles and what needs attention. */
export const strong = (s: string): string => pc.bold(text(s));

/** The color of each outcome, for a mark in another shape, like doctor's `[✓]`. */
export const statusColor = { pass: pc.green, warn: pc.yellow, fail: pc.red } as const;

/** The mark for each outcome, in front of a line that reports one. */
export const mark = {
  pass: statusColor.pass("✓"),
  warn: statusColor.warn("!"),
  fail: statusColor.fail("✗"),
} as const;

/** Between a thing and what it leads to: a package and its file, a problem and its fix. */
export const arrow = dim("→");
