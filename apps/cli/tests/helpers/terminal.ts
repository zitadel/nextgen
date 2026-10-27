import { Readable, Writable } from "node:stream";

/**
 * One of the answers a person types. A function is given everything written so
 * far, for an answer that can only be worked out from what was asked: the
 * number a listing gave the option the test means to choose.
 */
export type Answer = string | ((shown: string) => string);

/**
 * A person at the other end of the plain questions a normal command asks
 * (`lib/input.ts`). Everything the command writes is kept, and a chunk that
 * ends without a newline — a question waiting on an answer — is answered with
 * the next of `answers`. When they run out the input ends, which is the person
 * walking away rather than an empty answer.
 */
export function typing(...answers: Answer[]): {
  readonly stdin: Readable & { isTTY?: boolean };
  readonly stdout: Writable;
  shown(): string;
} {
  const written: string[] = [];
  const queued = [...answers];
  const stdin = new Readable({ read() {} });
  const stdout = new Writable({
    write(chunk: unknown, _encoding: unknown, done: (error?: Error | null) => void) {
      const text = String(chunk);
      written.push(text);
      if (!text.endsWith("\n")) {
        const next = queued.shift();
        const answer = typeof next === "function" ? next(written.join("")) : next;
        setImmediate(() => stdin.push(answer === undefined ? null : `${answer}\n`));
      }
      done();
    },
  });
  return { stdin, stdout, shown: () => written.join("") };
}

/**
 * Runs `run` as though a person were at a terminal: stdout and stdin are
 * TTYs, so a command is interactive unless it is told otherwise. Under the
 * test runner both are pipes. The originals are restored afterwards.
 */
export async function asTerminal<T>(run: () => Promise<T>): Promise<T> {
  const stdout = process.stdout.isTTY;
  const stdin = process.stdin.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
  }
}

/**
 * Runs `run` at a terminal with a person {@link typing} `answers` at the plain
 * questions it asks. A command reaches the terminal through the process rather
 * than being handed it, so the process's own streams are what stand in, and
 * what was written comes back beside the result.
 */
export async function asTerminalTyping<T>(
  answers: readonly Answer[],
  run: () => Promise<T>,
): Promise<{ result: T; shown: string }> {
  const talk = typing(...answers);
  const stdin = process.stdin;
  const write = process.stdout.write;
  Object.defineProperty(process, "stdin", { value: talk.stdin, configurable: true });
  process.stdout.write = ((chunk: string | Uint8Array) => {
    talk.stdout.write(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await asTerminal(run), shown: talk.shown() };
  } finally {
    process.stdout.write = write;
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  }
}
