import type { LogLevel } from "./log";
import { Output } from "./output";

/**
 * One line of narration as a normal command, or code with nobody to draw it,
 * says it: no mark and no gutter. What went wrong goes where errors go, and a
 * warning says so, because a line with no mark cannot otherwise be told apart
 * from the answer.
 *
 * This is the one place a plain line is written, so the logger's last resort
 * and a normal command's narration cannot read differently.
 *
 * @param level - What the line is.
 * @param text - The line, without a trailing newline.
 */
export function writePlain(level: LogLevel, text: string): void {
  if (level === "warn") {
    process.stderr.write(`Warning: ${text}\n`);
    return;
  }
  (level === "fail" || level === "debug" ? process.stderr : process.stdout).write(`${text}\n`);
}

/**
 * A line the person must have while the command waits on them, such as a link
 * to open. It is written to a pipe as to a terminal, so a script can act on it
 * before the command ends, and never under `--json`, where stdout is the
 * envelope's.
 *
 * @param text - The line, without a trailing newline.
 */
export function announce(text: string): void {
  if (!Output.json) {
    writePlain("info", text);
  }
}
