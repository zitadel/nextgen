import { installLogSink, type LogLevel } from "@/lib/log";

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
