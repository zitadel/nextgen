import { LOG_LEVELS, logText, renderLogLine } from "./local/server-log";

export type { LogLine } from "./local/server-log";

/** What a local server's log lines are, and how they are written for a person. */
export class ServerLogs {
  /** The levels a line can have, from the most verbose. */
  static readonly LEVELS: typeof LOG_LEVELS = LOG_LEVELS;

  /** The lines as one text. */
  static readonly text = logText;

  /** One line as it is drawn, coloured or not. */
  static readonly render = renderLogLine;
}
