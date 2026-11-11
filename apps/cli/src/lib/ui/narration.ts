import { installLogSink, type LogLevel } from "../log";
import { GUIDE, MARK } from "./marks";

/**
 * Draws the narration that library code and commands write with `log`.
 *
 * A wizard puts each line in its chain with the mark its level deserves. A
 * normal command says every level as a plain line, with no mark and no gutter,
 * so its narration looks like its flat prompts and its answer. The sink is
 * installed for one command and {@link Narration.restore}d when it ends, so a
 * second command in the same process — every command in the unit tests — never
 * draws into a chain that has closed.
 */

/** What the narration needs of the chain it draws into, and nothing more. */
export interface Narratable {
  /** Whether the command draws a chain, which is what a wizard does. */
  readonly chained: boolean;
  /** One line in the chain: its mark, then the text. */
  narrate(symbol: string, text: string): void;
}

/** The mark a level deserves in a chain. */
const MARKS: Readonly<Record<LogLevel, string>> = {
  done: MARK.done,
  info: MARK.info,
  start: MARK.started,
  warn: MARK.warning,
  fail: MARK.failed,
  plain: GUIDE,
  debug: MARK.detail,
};

export class Narration {
  private readonly chain: Narratable;
  private debug = false;
  private silent = false;
  private release: (() => void) | undefined;

  constructor(chain: Narratable) {
    this.chain = chain;
  }

  /** Whether narration is currently drawn by this. */
  get installed(): boolean {
    return this.release !== undefined;
  }

  /**
   * Draws narration until {@link restore}.
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
    this.release = installLogSink((level, text) => {
      this.draw(level, text);
    });
  }

  /** Stops drawing narration, whatever happened to the command. */
  restore(): void {
    this.release?.();
    this.release = undefined;
  }

  private draw(level: LogLevel, text: string): void {
    const body = text;
    if (this.silent || (level === "debug" && !this.debug)) {
      return;
    }
    if (this.chain.chained) {
      this.chain.narrate(MARKS[level], body);
      return;
    }
    // What went wrong goes where errors go, and a warning says so, because a
    // line with no mark cannot otherwise be told apart from the answer.
    if (level === "warn") {
      process.stderr.write(`Warning: ${body}\n`);
      return;
    }
    (level === "fail" ? process.stderr : process.stdout).write(`${body}\n`);
  }
}
