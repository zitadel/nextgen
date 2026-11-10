import { Writable } from "node:stream";

/** Any run of terminal control codes: colours, cursor moves, erases. */
const CONTROL = String.raw`(?:\x1b\[[0-9;?]*[A-Za-z])*`;

/** Colour codes alone, which is all that may sit between a prompt's mark and its text. */
const COLOUR = String.raw`(?:\x1b\[[0-9;]*m)*`;

/** The mark clack puts before a question, and the two spaces after it. */
const MARK = new RegExp(`${COLOUR}[◆◇■▲]${COLOUR}  `, "g");

/** A line's leading control codes, then its leading spaces, then what is left. */
const LEADING = new RegExp(`^(${CONTROL})( *)`);

/** Where clack rewrites a single line in place: back to column one, then the line. */
const COLUMN_ONE = "\u001b[G";

/** The streams already wrapped, so a run's many prompts share one listener on each. */
const wrapped = new WeakMap<NodeJS.WriteStream, Writable>();

/**
 * Clack as a normal command draws it: the question on a line of its own, with
 * the answer or the choices straight under it and nothing beside either.
 *
 * Clack has no setting for that. Without its guide it leaves the mark in front
 * of the question and the lines under it flush left, which looks ragged, so
 * this takes the mark off and the indent off. It works on the text clack
 * writes, one line at a time, and leaves every control code in place: those
 * are what move the cursor up to redraw a prompt, so a code that went missing
 * would leave the old frame on screen under the new one.
 *
 * @param chunk - What clack wrote in one go, which may hold several lines.
 * @returns The same text without the mark and without leading spaces.
 */
export function flatten(chunk: string): string {
  return chunk
    .split("\n")
    .map((line) => {
      return line.replace(LEADING, "$1");
    })
    .join("\n")
    .split(COLUMN_ONE)
    .map((part, at) => {
      return at === 0 ? part : part.replace(/^ +/, "");
    })
    .join(COLUMN_ONE)
    .replace(MARK, "");
}

/**
 * A stream for clack to draw on that writes {@link flatten}ed text to
 * `target`. It reports the target's size and tracks its resizes, which is how
 * clack decides where a line wraps and how far up to move to redraw.
 *
 * @param target - Where the flattened prompt is written.
 * @returns The stream to hand to a prompt as its `output`.
 */
export function flatOutput(target: NodeJS.WriteStream): Writable {
  const known = wrapped.get(target);
  if (known !== undefined) {
    return known;
  }
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      target.write(flatten(String(chunk)));
      done();
    },
  });
  Object.defineProperties(output, {
    isTTY: { value: true },
    columns: {
      get: () => {
        return target.columns ?? 80;
      },
    },
    rows: {
      get: () => {
        return target.rows ?? 24;
      },
    },
  });
  target.on("resize", () => {
    output.emit("resize");
  });
  wrapped.set(target, output);
  return output;
}
