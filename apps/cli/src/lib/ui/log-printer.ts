import { log, type LogLevel } from "./log";
import { MARK } from "./marks";
import { Output } from "./output";
import { writePlain } from "./plain";
import { DrawnSpinner } from "./spinner";

/** What the log printer needs of the chain it draws into, and nothing more. */
export interface Narratable {
  /** Whether the command draws a chain, which is what a wizard does. */
  readonly chained: boolean;
  /** One line in the chain: its mark, then the text. */
  narrate(symbol: string, text: string): void;
}

/** The mark a level deserves in a chain. */
const MARKS: Readonly<Record<LogLevel, string>> = {
  info: MARK.info,
  warn: MARK.warning,
  fail: MARK.failed,
  debug: MARK.detail,
};

/**
 * Draws what commands and library code say with `log`. It is the sink behind
 * the logger: `log.info(...)` only hands a line over, and this decides what the
 * line becomes.
 *
 * Under `--json` nothing is drawn. When stdout is not a terminal only warnings
 * and failures are written, and `debug` goes to stderr. On a terminal a wizard
 * puts each line in its chain with the mark its level deserves, and a normal
 * command says it as a plain line with no mark and no gutter. It is installed
 * for one command and {@link LogPrinter.restore}d when it ends, so a second
 * command in the same process, as every command in the unit tests is, never
 * draws into a chain that has closed.
 */
export class LogPrinter {
  private readonly chain: Narratable;
  private debug = false;
  private silent = false;
  private release: (() => void) | undefined;

  constructor(chain: Narratable) {
    this.chain = chain;
  }

  /** Whether this is currently drawing what `log` says. */
  get installed(): boolean {
    return this.release !== undefined;
  }

  /**
   * Draws what `log` says until {@link restore}.
   *
   * @param options - `debug` also draws the detail that only `--debug` asks for.
   *   `silent` draws nothing at all, which is what `--json` asks for: the sink
   *   is installed so that a line is swallowed here, not written plainly.
   */
  install(options: { debug?: boolean; silent?: boolean } = {}): void {
    if (this.release !== undefined) {
      return;
    }
    this.debug = options.debug ?? false;
    this.silent = options.silent ?? false;
    this.release = log.install((level, text) => {
      this.draw(level, text);
    });
  }

  /** Stops drawing what `log` says, whatever happened to the command. */
  restore(): void {
    this.release?.();
    this.release = undefined;
  }

  private draw(level: LogLevel, text: string): void {
    if (this.silent || (level === "debug" && !this.debug)) {
      return;
    }
    if (!Output.screen && level === "debug") {
      // Diagnostics go beside the answer, so a script reading stdout never gets them.
      DrawnSpinner.around(() => {
        process.stderr.write(`${text}\n`);
      });
      return;
    }
    if (!Output.screen && level !== "warn" && level !== "fail") {
      return;
    }
    if (this.chain.chained) {
      this.chain.narrate(MARKS[level], text);
      return;
    }
    // A line written while a spinner draws would be glued to its frame.
    DrawnSpinner.around(() => {
      return writePlain(level, text);
    });
  }
}
