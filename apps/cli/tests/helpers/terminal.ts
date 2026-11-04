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
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: stdinIsTTY, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
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
