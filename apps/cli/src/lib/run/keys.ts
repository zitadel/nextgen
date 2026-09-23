/** End of text (Ctrl-C) and end of transmission (Ctrl-D). */
const CTRL_C = "";
const CTRL_D = "";

export type KeyReader = {
  /** Restores the terminal to the mode the session started in. */
  stop: () => void;
};

export type KeyReaderOptions = {
  /** One keypress, as the character typed. Ctrl-C and Ctrl-D arrive as `quit`. */
  onKey: (key: string) => void;
  onQuit: () => void;
  stdin?: NodeJS.ReadStream;
};

/**
 * Reads single keypresses while the run loop streams output.
 *
 * Raw mode is what makes `r` act on the keystroke instead of on the Enter that
 * would otherwise have to follow it. It also turns off the terminal's own
 * interrupt handling, so Ctrl-C no longer raises `SIGINT` and arrives as a
 * byte: the reader translates it back into a quit so the session still shuts
 * down the way every other terminal program does.
 *
 * Returns `undefined` when stdin is not a TTY (a pipe, a CI runner). There is
 * nobody to press a key then, and forcing raw mode on a non-TTY throws.
 */
export function readKeys(options: KeyReaderOptions): KeyReader | undefined {
  const stdin = options.stdin ?? process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return undefined;
  }

  const onData = (chunk: string): void => {
    for (const key of chunk) {
      if (key === CTRL_C || key === CTRL_D) {
        options.onQuit();
        return;
      }
      options.onKey(key);
    }
  };

  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onData);

  let stopped = false;
  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      stdin.off("data", onData);
      // Leaving a terminal in raw mode outlives this process: the shell that
      // gets the terminal back would stop echoing what the user types.
      stdin.setRawMode?.(Boolean(wasRaw));
      stdin.pause();
    },
  };
}
