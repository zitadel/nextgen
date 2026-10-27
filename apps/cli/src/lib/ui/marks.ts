import pc from "picocolors";

/**
 * The marks that say what a line in the chain is, so a reader can tell a
 * question from something that happened without reading the words. Only the
 * chain draws them; nothing else should invent one.
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
} as const;
