import pc from "picocolors";

/**
 * The marks that say what a line in the chain is, so a reader can tell a
 * question from something that happened without reading the words.
 *
 * Every glyph the CLI draws in the gutter is named here and nowhere else: a
 * module that spells its own `pc.green("✔")` is a module that can drift from
 * the rest, and the mark a line carries is then no longer a fact a reader can
 * rely on. Each one is a single column wide, so the gutter stays straight
 * however many lines are stacked under it.
 */

/** The gutter that runs down the chain, and continues a line under its mark. */
export const GUIDE = pc.gray("│");

export const MARK = {
  /** A step that finished, and anything a task reports as done. */
  done: pc.green("✔"),
  /** Something deliberately left alone. */
  skipped: pc.dim("–"),
  /** Something that worked but wants a look. */
  warning: pc.yellow("!"),
  /** A step that failed; the error itself is said by the ending. */
  failed: pc.red("✖"),
  /** A statement of fact: what a command found, or where it is pointed. */
  info: pc.cyan("ℹ"),
  /** Work that has begun and has not reported its result yet. */
  started: pc.cyan("◐"),
  /** Detail nobody asked for, drawn only under `--verbose` and `--debug`. */
  detail: pc.dim("·"),
} as const;
