import type { Audience } from "./audience";
import { Chain } from "./chain";
import { Narration } from "./narration";
import type { Outcome, Summary } from "./summary";
import type { Report, Step, Wizard } from "./wizard";

/**
 * What a command is given as `this.ui`: one chain, and the ways to draw in it.
 *
 * A command names what it is doing (`static heading`), asks its questions and
 * does its work inside `wizard(...)`, and returns an {@link Outcome}. The base
 * command closes the chain on that outcome's summary, so the ending looks the
 * same in every command and no command has to remember to print one.
 *
 * ```ts
 * export default class OriginRm extends Promptable(EnvironmentCommand) {
 *   static override heading = "Removing an origin";
 *
 *   override async execute() {
 *     return this.ui.wizard(async (w) => {
 *       if (!(await w.confirm({ name: "remove the origin", message: `Remove ${pattern}?` }))) {
 *         return outcome({ removed: false }, { title: "Nothing was removed", sections: [] });
 *       }
 *       await w.task("Removing the origin", () => remove(pattern));
 *       return outcome({ removed: true }, { title: `Removed ${pattern}`, sections: [] });
 *     });
 *   }
 * }
 * ```
 */
export class Ui {
  private readonly audience: Audience;
  private readonly chain: Chain;
  private readonly narration: Narration;

  constructor(audience: Audience) {
    this.audience = audience;
    this.chain = new Chain(audience);
    this.narration = new Narration(this.chain);
  }

  /** Whether anything is drawn: false under `--json`, `--non-interactive` and no terminal. */
  get interactive(): boolean {
    return this.audience.interactive;
  }

  /** Whether the chain has been drawn into. */
  get opened(): boolean {
    return this.chain.isOpen;
  }

  /** Names the chain by what the command is doing: `Listing origins`. */
  describe(title: string): void {
    this.chain.describe(title);
  }

  /**
   * Where this command runs. Its summary opens with it, in place of the
   * `ℹ Project` / `ℹ Server` lines a command used to print before its first
   * question.
   */
  ranAgainst(project: string | undefined, server: string | undefined): void {
    this.chain.ranAgainst(project, server);
  }

  /**
   * Draws the narration the CLI still writes with `consola` inside the chain.
   * See {@link bridgeNarration}.
   */
  bridgeNarration(): void {
    if (this.audience.interactive) {
      this.narration.install();
    }
  }

  /**
   * Gives `consola` its reporters back. The base command calls it when the
   * command ends, so the next command in this process starts from a clean slate.
   */
  releaseNarration(): void {
    this.narration.restore();
  }

  /** Opens the chain if it is not open. Called before anything is drawn. */
  open(): void {
    this.chain.open();
  }

  /** A prompt was just answered, so the next thing drawn leaves a blank guide line first. */
  answered(): void {
    this.chain.answered();
  }

  /**
   * Work that takes a moment, outside a `wizard` callback (see {@link Wizard.task}).
   * With nobody at a terminal it is narrated as plain lines, which `--json` silences.
   */
  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    return this.chain.task(label, work, done);
  }

  /** Something the person must read or do (see {@link Wizard.note}). */
  note(title: string, lines: readonly string[]): void {
    this.chain.note(title, lines);
  }

  /**
   * Begins work that cannot be wrapped in a callback, because the code around it
   * is a long run of steps with their own error handling. A spinner runs until
   * `done` or `fail`.
   */
  begin(label: string): Step {
    return this.chain.begin(label);
  }

  /** Closes the chain on its summary. A command does not call this; the base command does. */
  finish(summary: Summary): void {
    this.chain.finish(summary);
  }

  /**
   * Runs a whole command as one chain and returns its data. The chain opens at
   * the first thing the person sees and closes on the summary. When nobody is
   * there, questions are answered from flags and stdin only and nothing is
   * drawn, so `--json` stays one envelope.
   *
   * `honorForce: false` is for `setup`, whose `--force` means "overwrite files"
   * and so must never answer a question.
   */
  async wizard<D>(
    title: string,
    steps: (wizard: Wizard) => Promise<Outcome<D>>,
    options: { honorForce?: boolean } = {},
  ): Promise<D> {
    this.chain.describe(title);
    this.chain.honorForce(options.honorForce !== false);
    try {
      const result = await steps(this.chain);
      this.chain.finish(result.summary);
      return result.data;
    } catch (error) {
      this.chain.abort(error);
      throw error;
    }
  }
}
