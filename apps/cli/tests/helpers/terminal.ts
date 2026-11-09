import { Readable, Writable } from "node:stream";
import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach } from "vitest";

/**
 * Makes every test in the calling suite run as though a person were at a
 * terminal: stdout and stdin report `isTTY`, so a command is interactive
 * unless it is told otherwise. Each test gets the streams back as it found
 * them, so a stream that had no own `isTTY` gets none back.
 *
 * @returns Once the hooks are registered.
 */
export function useTerminal(): void {
  const found = new Map<NodeJS.WriteStream | NodeJS.ReadStream, PropertyDescriptor | undefined>();
  beforeEach(() => {
    for (const stream of [process.stdout, process.stdin]) {
      found.set(stream, Object.getOwnPropertyDescriptor(stream, "isTTY"));
      Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
    }
  });
  afterEach(() => {
    for (const [stream, descriptor] of found) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(stream, "isTTY");
      } else {
        Object.defineProperty(stream, "isTTY", descriptor);
      }
    }
    found.clear();
  });
}

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
 * Runs `run` with stdout and stdin reporting `isTTY` as given, and restores
 * the originals afterwards.
 */
async function withTerminal<T>(
  isTTY: boolean,
  run: () => Promise<T>,
  stdinIsTTY: boolean = isTTY,
): Promise<T> {
  const stdout = process.stdout.isTTY;
  const stdin = process.stdin.isTTY;
  Object.defineProperty(process.stdout, "isTTY", {
    value: isTTY,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdinIsTTY,
    writable: true,
    configurable: true,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      value: stdout,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdin,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Runs `run` as though a person were at a terminal: stdout and stdin are
 * TTYs, so a command is interactive unless it is told otherwise. Under the
 * test runner both are pipes. The originals are restored afterwards.
 */
export async function asTerminal<T>(run: () => Promise<T>): Promise<T> {
  return withTerminal(true, run);
}

/**
 * Runs `run` as though stdout and stdin were pipes, whatever the runner's own
 * streams are, so a test of piped behaviour does not depend on how it was
 * started. The originals are restored afterwards.
 */
export async function offTerminal<T>(run: () => Promise<T>): Promise<T> {
  return withTerminal(false, run);
}

/**
 * Runs `run` as though the output went to a terminal while the input came from
 * a file or a closed stream, as `zitadel logs < /dev/null` does. The two say
 * different things: one is where output goes, the other whether anyone can be
 * asked something. The originals are restored afterwards.
 */
export async function onTerminalReadingAFile<T>(run: () => Promise<T>): Promise<T> {
  return withTerminal(true, run, false);
}

/**
 * The two ways a terminal shows the same run, for a spec to table over: the
 * colour the CLI paints, and the plain text a `NO_COLOR` reader sees. Colour is
 * settled off for every run, so a test that wants it asks for it here.
 *
 * The content matchers read what was printed rather than how it was painted, so
 * one assertion holds for both rows.
 */
export const RENDERINGS = [
  ["in colour", { FORCE_COLOR: "1" }],
  // `NO_COLOR`, not an empty environment: on a terminal `picocolors` turns
  // colour on by itself, so a row that only left `FORCE_COLOR` unset would be
  // the coloured one twice.
  ["without colour", { NO_COLOR: "1" }],
] as const satisfies ReadonlyArray<readonly [string, NodeJS.ProcessEnv]>;

/**
 * Runs `run` at a terminal with a person {@link typing} `answers` at the plain
 * questions it asks. A command reaches the terminal through the process rather
 * than being handed it, so the process's own streams are what stand in, and
 * what was written comes back beside the result.
 */
export async function asTerminalTyping<T>(
  answers: readonly Answer[],
  run: () => Promise<T>,
): Promise<{ result: Awaited<T>; shown: string }> {
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

/**
 * Everything a run said, as one line: the box's border taken off and every
 * fold rejoined.
 *
 * An ending is laid out for a terminal 80 columns wide, so where a sentence
 * folds depends on what happens to be in it, and a step's command sits on a
 * line of its own under the sentence that introduces it. A test that reads
 * what a command said reads it here, rather than pinning where the layout
 * broke it.
 */
export const asOneLine = (shown: string): string =>
  stripAnsi(shown)
    .replace(/[│╭╮╰╯─]/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll(" \\ ", " ")
    .trim();
