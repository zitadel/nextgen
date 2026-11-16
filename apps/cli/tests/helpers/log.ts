import { installLogSink, type LogLevel } from "@/lib/log";
import { test as base } from "./port";

/** One line of narration, as the code under test said it. */
export interface Said {
  level: LogLevel;
  text: string;
}

/**
 * Collects the narration that code says with `log`, in place of drawing it.
 * It is the real sink every command gets, with a different place to put the
 * lines, so a test reads what was said without anything being replaced.
 *
 * @returns The lines so far, and `stop` to give back whatever was installed.
 */
export function recordLog(): { said: Said[]; stop: () => void } {
  const said: Said[] = [];
  const stop = installLogSink((level, text) => {
    said.push({ level, text });
  });
  return { said, stop };
}

/** What {@link recordLog} gives back: the lines said so far, and the way to stop listening. */
export type RecordedLog = ReturnType<typeof recordLog>;

/**
 * `test` with the narration of the code under test, read instead of drawn.
 *
 * - `recorded` is the {@link recordLog} sink, listening for the length of the test; it stops
 *   when the test ends, or earlier through its own `stop`.
 */
export const test = base.extend<{ recorded: RecordedLog }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async recorded({}, use) {
    const sink = recordLog();
    await use(sink);
    sink.stop();
  },
});
