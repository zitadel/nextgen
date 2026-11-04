import pc from "picocolors";

/**
 * The CLI's palette, named for what the text is rather than the color it gets,
 * so one kind of thing looks the same in every command. `picocolors` decides
 * whether color is on, so `--no-color`, `NO_COLOR` and piped output all stay
 * plain. Style human output through these, not `picocolors` directly.
 */

/** Bold cyan, for commands the user should run. */
export const command = (s: string): string => pc.bold(pc.cyan(s));
/** Cyan, for filesystem paths the user can open. */
export const path = (s: string): string => pc.cyan(s);
/** Cyan, for URLs (browser-clickable in most terminals). */
export const url = (s: string): string => pc.cyan(s);
/** Yellow, for opaque ids the user shouldn't try to read. */
export const id = (s: string): string => pc.yellow(s);
/** Dim, for separators and secondary detail. */
export const dim = (s: string): string => pc.dim(s);
/** Bold, for titles and what needs attention. */
export const strong = (s: string): string => pc.bold(s);

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
