import type { Audience } from "./audience";
import { Chain } from "./chain";
import { Narration } from "./narration";
import type { Report, Step } from "./progress";
import type { Questions } from "./questions";
import type { Spinner } from "./spinner";
import type { Summary } from "./summary";

/**
 * What a command is given as `this.ui`: one chain, and the ways to draw in it.
 *
 * A command names what it is doing (`static heading`), asks its questions
 * through {@link Questions} and reports its work as {@link task}s and
 * {@link note}s. The base command closes the chain on the result the command
 * returned, so the ending looks the same in every command and no command has
 * to remember to print one.
 *
 * ```ts
 * export default class OriginRm extends Promptable(EnvironmentCommand) {
 *   static override heading = "Removing an origin";
 *
 *   override async execute() {
 *     const remove = await this.ask.confirm({
 *       name: "remove the origin",
 *       message: `Remove ${pattern}?`,
 *     });
 *     if (!remove) {
 *       return this.emit({ status: "skipped", reason: "remove-cancelled" });
 *     }
 *     await this.ui.task("Removing the origin", () => remove(pattern));
 *     return this.emit({ status: "ok", pretty: `Removed ${pattern}` });
 *   }
 * }
 * ```
 *
 * {@link describe}, {@link bridgeNarration}, {@link open} and {@link finish}
 * are the base command's, not a command's: they name the chain, bridge
 * `consola` into it and close it on the result the command returned. A command
 * that reaches for them is a command drawing outside its own chain.
 */
export class Ui {
  private readonly chain: Chain;
  private readonly narration: Narration;

  constructor(audience: Audience) {
    this.chain = new Chain(audience);
    this.narration = new Narration(this.chain);
  }

  /** Whether anything is drawn: false under `--json`, `--non-interactive` and no terminal. */
  get interactive(): boolean {
    return this.chain.interactive;
  }

  /** Whether the chain has been drawn into. */
  get opened(): boolean {
    return this.chain.isOpen;
  }

  /**
   * The questions this command may ask, drawn inside its chain. A command
   * reaches them as `this.ask` (`Promptable`). When nobody is there they are
   * answered from flags and piped stdin only and nothing is drawn, so `--json`
   * stays one envelope.
   *
   * `honorForce: false` is for `setup`, whose `--force` means "overwrite files"
   * and so must never answer a question.
   */
  questions(options: { honorForce?: boolean } = {}): Questions {
    return this.chain.questions(options.honorForce !== false);
  }

  /**
   * Closes a chain the command never got to finish, so an interrupted run
   * does not leave the shell prompt inside the gutter. A question the person
   * cancelled has already closed itself and is left alone.
   */
  stop(error: unknown): void {
    this.chain.abort(error);
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
   * Draws the narration the CLI still writes with `consola` inside the chain,
   * until {@link releaseNarration}.
   */
  bridgeNarration(): void {
    if (this.interactive) {
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
   * Work that takes a moment, as a callback: a spinner while it runs, then its
   * result as one line with whatever it reported under it. With nobody at a
   * terminal it is narrated as plain lines, which `--json` silences.
   */
  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    return this.chain.task(label, work, done);
  }

  /**
   * One line in the chain that states something the run has settled, such as
   * what happens now that a provider was skipped. It is not a question, not a
   * {@link task} that did work and not something to go and do ({@link note});
   * with nobody watching it is a plain `consola` line.
   */
  say(text: string): void {
    this.chain.say(text);
  }

  /**
   * Something the person must read or go and do outside the terminal, such as
   * registering an OAuth app. It is the only boxed thing inside a chain; what
   * merely happened is a {@link task}'s line, and what is left to do is the
   * summary's next steps.
   */
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

  /**
   * A spinner the caller stops itself, for work that neither {@link task} nor
   * {@link begin} fits: a probe whose result decides the next question, or a
   * loop that renames the spinner as it goes. It draws nothing when nobody is
   * watching, so no caller tests for a terminal.
   */
  spinner(label: string, options: { guide?: boolean } = {}): Spinner {
    return this.chain.spinner(label, options);
  }

  /** Closes the chain on its summary. A command does not call this; the base command does. */
  finish(summary: Summary): void {
    this.chain.finish(summary);
  }

  /**
   * The ending as text, for a command whose report is the whole point of the
   * run and which therefore has to show one with nobody at a terminal, where
   * {@link finish} draws nothing. The command returns it as its own rendering;
   * it is laid out here so that the two endings cannot drift apart.
   */
  ending(summary: Summary): string {
    return this.chain.ending(summary);
  }
}
