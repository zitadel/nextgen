import { open, stat } from "node:fs/promises";

const POLL_INTERVAL_MS = 300;

export type LogTailOptions = {
  /** Byte offset to start from. Defaults to the file's current end. */
  from?: number;
  intervalMs?: number;
  onChunk: (text: string) => void;
};

export type LogTail = {
  /** Reads whatever has been appended since the last poll. */
  poll: () => Promise<void>;
  stop: () => void;
};

/**
 * Follows a growing log file and hands every appended chunk to `onChunk`.
 *
 * The binary runtime is detached and writes to a log file rather than to this
 * process's pipes, so a `run` session that wants the server's output has to
 * read that file the way `tail -f` does. Polling rather than watching: the
 * file is appended to by another process, `fs.watch` reports that
 * inconsistently across platforms, and a poll is cheap against a `stat`.
 *
 * A file that shrank was rotated or truncated (a restarted runtime opens the
 * same path), so the tail resumes from its new beginning instead of waiting
 * for it to grow past a stale offset.
 */
export function tailLogFile(path: string, options: LogTailOptions): LogTail {
  let offset = options.from;
  let stopped = false;

  const poll = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      // The file appears when the runtime first writes to it.
      return;
    }
    offset ??= size;
    if (size < offset) {
      offset = 0;
    }
    if (size === offset) {
      return;
    }
    const handle = await open(path, "r");
    try {
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      offset += bytesRead;
      if (bytesRead > 0 && !stopped) {
        options.onChunk(buffer.subarray(0, bytesRead).toString("utf8"));
      }
    } finally {
      await handle.close();
    }
  };

  const timer = setInterval(() => {
    void poll().catch(() => {
      // A transient read failure must not take the session down; the next
      // poll picks up from the same offset.
    });
  }, options.intervalMs ?? POLL_INTERVAL_MS);
  // The tail must never be the reason the process stays alive: the run loop
  // decides when the session ends.
  timer.unref();

  return {
    poll,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
