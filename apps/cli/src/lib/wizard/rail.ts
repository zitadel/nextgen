import { Writable } from "node:stream";

/** The parts of a terminal stream the rail reads. */
export type StreamLike = NodeJS.WritableStream & {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
};

/** The escape sequence that starts at `text[at]`, or `undefined` when it is not a CSI sequence. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences
const CSI = /^\u001b\[[0-9;?]*[ -/]*[@-~]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences
const ANY_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Characters a terminal shows, so the width of a styled string. */
export function visibleLength(text: string): number {
  return [...text.replace(ANY_CSI, "")].length;
}

/**
 * Whether a control sequence leaves the cursor in the first column: a move to
 * column one, or a left move far enough to get there. Prompt libraries redraw a
 * frame by going to the start of the line, so this is how the next printable
 * character is known to begin a line.
 */
function returnsToLineStart(sequence: string): boolean {
  const final = sequence.at(-1);
  const amount = Number(sequence.slice(2, -1).split(";")[0] || 1);
  return final === "G" || (final === "D" && amount >= 100);
}

/**
 * A stream that indents everything written to it, line by line, and passes the
 * rest of the terminal protocol through untouched.
 *
 * A prompt library draws a frame, then erases and redraws it as an answer
 * changes, using cursor moves. Indenting what it writes is enough to nest it
 * under a branch, provided three things hold: the indent goes in front of
 * each line's first visible character (so a colour that starts a line does not
 * colour the indent), cursor and erase sequences are never indented, and the
 * width the library wraps to is reduced by the indent. This does all three.
 */
class IndentedStream extends Writable {
  private atLineStart = true;
  private pendingStyle = "";

  private readonly target: StreamLike;
  private readonly indent: () => string;

  constructor(target: StreamLike, indent: () => string) {
    super();
    this.target = target;
    this.indent = indent;
  }

  get columns(): number {
    return Math.max(20, (this.target.columns ?? 80) - visibleLength(this.indent()));
  }

  get rows(): number | undefined {
    return this.target.rows;
  }

  get isTTY(): boolean | undefined {
    return this.target.isTTY;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.target.write(this.indented(chunk.toString()));
    callback();
  }

  private indented(text: string): string {
    let out = "";
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at] as string;
      if (char === "\u001b") {
        const sequence = CSI.exec(text.slice(at))?.[0];
        if (sequence === undefined) {
          out += char;
          continue;
        }
        at += sequence.length - 1;
        if (sequence.endsWith("m") && this.atLineStart) {
          this.pendingStyle += sequence;
          continue;
        }
        out += sequence;
        if (returnsToLineStart(sequence)) {
          this.atLineStart = true;
        }
        continue;
      }
      if (char === "\r" || char === "\n") {
        // A blank line keeps the rail unbroken.
        if (char === "\n" && this.atLineStart) {
          out += this.indent().trimEnd();
        }
        out += this.pendingStyle + char;
        this.pendingStyle = "";
        this.atLineStart = true;
        continue;
      }
      if (this.atLineStart) {
        out += this.indent() + this.pendingStyle;
        this.pendingStyle = "";
        this.atLineStart = false;
      }
      out += char;
    }
    return out;
  }
}

/**
 * The left edge of a wizard: a stack of indents, and a stream that applies
 * them. Entering a branch pushes one segment; leaving pops it.
 */
export class Rail {
  readonly stream: IndentedStream;
  private readonly segments: string[] = [];

  constructor(target: StreamLike) {
    this.stream = new IndentedStream(target, () => this.indent);
  }

  get indent(): string {
    return this.segments.join("");
  }

  get depth(): number {
    return this.segments.length;
  }

  push(segment: string): void {
    this.segments.push(segment);
  }

  pop(): void {
    this.segments.pop();
  }
}
