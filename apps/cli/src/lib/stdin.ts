/** A stream piped into the process, read as one value. */
export class Stdin {
  /** The stream to read. */
  private readonly stream: NodeJS.ReadableStream;

  /**
   * @param stream - The stream to read to its end, usually `process.stdin`.
   */
  private constructor(stream: NodeJS.ReadableStream) {
    this.stream = stream;
  }

  /**
   * The input on a stream.
   *
   * @param stream - The stream to read, usually `process.stdin`.
   * @returns The input.
   */
  static on(stream: NodeJS.ReadableStream): Stdin {
    return new Stdin(stream);
  }

  /**
   * Read the value, for the non-interactive path
   * (`variable set NAME --secret < secret.txt`).
   *
   * A single trailing newline is stripped — a here-doc or `echo` adds one and
   * it is not part of the credential — but nothing else is trimmed, because
   * whitespace inside a value is the caller's to decide.
   *
   * @returns The text, without one trailing line break.
   */
  async read(): Promise<string> {
    // Accumulated as bytes and decoded once, so a leading byte-order mark is kept: it
    // is part of what was piped, and `TextDecoder` would drop it.
    const chunks: Buffer[] = [];
    for await (const chunk of this.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  }
}
