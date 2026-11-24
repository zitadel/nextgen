import type { Audience } from "./audience";
import { Asker, type Session } from "./asker";
import { Box } from "./box";
import { Chain } from "./chain";
import { LogPrinter } from "./log-printer";
import type { Presentation } from "./presentation";
import type { Report, Step } from "./progress";
import type { Confirmer, Questions } from "./questions";
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
 * export default class OriginSync extends Promptable(EnvironmentCommand) {
 *   override async execute() {
 *     const go = await this.ask.yesNo({
 *       name: "sync the origins",
 *       message: "Would you like to sync the origins?",
 *     });
 *     if (!go) {
 *       return {
 *         status: "skipped",
 *         reason: "sync-cancelled",
 *         summary: { title: "Cancelled", sections: [] },
 *       };
 *     }
 *     await this.ui.task("Syncing the origins", () => sync());
 *     return {
 *       status: "ok",
 *       data: {},
 *       summary: { title: "Synced the origins", sections: [] },
 *     };
 *   }
 * }
 * ```
 *
 * {@link describe}, {@link printLogs} and {@link finish} are the base
 * command's, not a command's: they name the chain, draw what `log` says into it
 * and close it on the result the command returned. A command that reaches for
 * them is a command drawing outside its own chain. The chain opens itself at
 * the first thing a person sees, so nothing opens it by hand.
 */
export class Ui {
  private readonly chain: Chain;
  private readonly printer: LogPrinter;
  /** Whether a command took its own ending away as text ({@link ending}). */
  private handedOver = false;

  /**
   * Questions answered from a session instead of from a run's audience, for
   * a caller that has no chain: a test, or a library handed its own session.
   * A command reaches its questions as `this.ask`.
   *
   * @param session - Who can answer, and how a prompt is drawn.
   * @returns The questions, bound to the session.
   */
  static asker(session: Session): Questions & Confirmer {
    return Asker.for(session);
  }

  /**
   * Wraps content to the terminal so a frame drawn around it never exceeds the
   * window, for a caller that draws a frame of its own.
   *
   * @param message - The content to wrap.
   * @param columns - The terminal's width. Defaults to stdout's.
   * @returns The content, wrapped to fit inside a frame.
   */
  static wrap(message: string, columns?: number): string {
    return Box.at(columns).wrap(message);
  }

  constructor(audience: Audience, presentation: Presentation = "wizard") {
    this.chain = new Chain(audience, presentation);
    this.printer = new LogPrinter(this.chain);
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
   * Whether the command rendered its own ending with {@link ending}, and so
   * has already said everything an ending says. The base command writes what
   * such a command returned as it is, rather than ending a run that has
   * ended.
   */
  get reported(): boolean {
    return this.handedOver;
  }

  /**
   * The questions this command may ask, drawn inside its chain. A command
   * reaches them as `this.ask` (`Promptable`). When nobody is there they are
   * answered from flags and piped stdin only and nothing is drawn, so `--json`
   * stays one envelope.
   *
   * None of them is answered by `--force`: that answers a destructive
   * confirmation alone, which is {@link confirmer}'s.
   */
  questions(): Questions {
    return this.chain.questions();
  }

  /**
   * Be told each time a prompt is about to be drawn. See {@link Chain.listenToPrompts}.
   *
   * @param listener - Called before the prompt is drawn.
   */
  onPrompt(listener: () => void): void {
    this.chain.listenToPrompts(listener);
  }

  /**
   * The one question `--force` answers, which is whether a destructive action
   * may go ahead. Only `Consent.request` asks it: it is not among
   * {@link questions}, so a command cannot get a boolean for it.
   */
  confirmer(session?: { interactive: boolean; force: boolean }): Confirmer {
    return this.chain.questions(session);
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
   * Where this command runs. Its summary opens with it, rather than
   * with separate `ℹ Project` / `ℹ Server` lines before the first question.
   */
  ranAgainst(project: string | undefined, server: string | undefined): void {
    this.chain.ranAgainst(project, server);
  }

  /**
   * Draws what the command and the library code under it say with `log`, until
   * {@link stopPrintingLogs}. A wizard draws it in its chain with a mark; a
   * normal command says it as plain lines, because a warning must not be what
   * turns a normal command into a wizard.
   *
   * It is installed whether or not anybody is watching, because what a line of
   * narration says belongs to the command: a run nothing is drawn into gets
   * the same marks written out. `--json` installs nothing, so nothing reaches
   * a terminal there.
   *
   * @param options - `debug` also draws the detail that only `--debug` asks for;
   *   `silent` draws nothing, for `--json`.
   */
  printLogs(options: { debug?: boolean; silent?: boolean } = {}): void {
    this.printer.install(options);
  }

  /**
   * Stops drawing what `log` says. The base command calls it when the command ends,
   * so the next command in this process starts from a clean slate.
   */
  stopPrintingLogs(): void {
    this.printer.restore();
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
   * with nobody watching it is a plain line.
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
   * The report as text, for a command whose report is the whole point of the
   * run and which therefore has to show one with nobody at a terminal, where
   * {@link finish} draws nothing. The command returns it as its own rendering;
   * it is laid out here so that the two endings cannot drift apart, and the
   * run is marked as {@link reported} so the base command does not end it a
   * second time.
   */
  ending(summary: Summary): string {
    this.handedOver = true;

    return this.chain.ending(summary);
  }

  /**
   * The whole ending as text, for a run nothing can be drawn into: the line
   * the chain would have closed on and everything that would have sat under
   * it, in the same words. The caller writes it where it belongs — stdout for
   * an answer, stderr for a failure — so that `--json` stays one envelope.
   */
  written(summary: Summary): string {
    return this.chain.written(summary);
  }
}
