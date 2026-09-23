import pc from "picocolors";

/**
 * Which process a line of output came from. `cli` is the run loop narrating
 * itself (starting, applying, restarting); the other two are the processes it
 * supervises.
 */
export type RunSource = "app" | "cli" | "server";

const LABELS: Record<RunSource, { paint: (s: string) => string; text: string }> = {
  server: { paint: pc.magenta, text: "server" },
  app: { paint: pc.cyan, text: "app" },
  cli: { paint: pc.dim, text: "zitadel" },
};

/** Widest label, so every prefix occupies the same number of columns. */
const LABEL_WIDTH = Math.max(...Object.values(LABELS).map((label) => label.text.length));

/** Renders the column that precedes every line of a source's output. */
export function prefixFor(source: RunSource): string {
  const label = LABELS[source];
  return label.paint(`${label.text.padEnd(LABEL_WIDTH)} │ `);
}

/**
 * Interleaves the output of the supervised processes onto one stream, one
 * prefixed line at a time.
 *
 * Buffering per source is the point: a dev server writes its output in
 * whatever chunks it happens to flush, and prefixing chunks rather than lines
 * would drop the prefix into the middle of a sentence and interleave two
 * processes mid-line. Only complete lines are emitted; a trailing partial line
 * waits for the rest of it, or for {@link RunOutput.flush} at shutdown.
 */
export class RunOutput {
  private readonly pending = new Map<RunSource, string>();

  constructor(private readonly sink: (text: string) => void = (text) => process.stdout.write(text)) {}

  /** Buffers a chunk from one source and emits whatever completes a line. */
  write(source: RunSource, chunk: string): void {
    const buffered = `${this.pending.get(source) ?? ""}${chunk}`;
    const lines = buffered.split("\n");
    // The last element is what follows the final newline: empty when the chunk
    // ended on one, a partial line otherwise. Either way it is not ready yet.
    this.pending.set(source, lines.pop() ?? "");
    for (const line of lines) {
      this.sink(`${prefixFor(source)}${trimCarriageReturn(line)}\n`);
    }
  }

  /** Emits one complete line, used by the loop's own narration. */
  line(source: RunSource, text: string): void {
    this.flushSource(source);
    for (const line of text.split("\n")) {
      this.sink(`${prefixFor(source)}${line}\n`);
    }
  }

  /** Emits an unprefixed line, for banners and key hints. */
  raw(text: string): void {
    this.sink(`${text}\n`);
  }

  /** Emits every buffered partial line, e.g. a prompt with no trailing newline. */
  flush(): void {
    for (const source of [...this.pending.keys()]) {
      this.flushSource(source);
    }
  }

  private flushSource(source: RunSource): void {
    const partial = this.pending.get(source);
    if (partial) {
      this.sink(`${prefixFor(source)}${trimCarriageReturn(partial)}\n`);
    }
    this.pending.set(source, "");
  }
}

/**
 * Drops the carriage return of a CRLF line ending. Progress output that
 * repaints a line with a bare `\r` keeps it: the terminal still redraws, it
 * just redraws after the prefix.
 */
function trimCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
