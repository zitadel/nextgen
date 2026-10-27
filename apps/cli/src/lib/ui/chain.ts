import { intro, log, note, outro } from "@clack/prompts";
import { consola } from "consola";
import pc from "picocolors";

import { CANCELLED, ZitadelError } from "../errors";
import { asker, plainAsker } from "../input";
import type { Audience } from "./audience";
import { Ending } from "./ending";
import { GUTTER, Prose, WIDTH } from "./layout";
import { MARK } from "./marks";
import type { Narratable } from "./narration";
import type { Presentation } from "./presentation";
import { type Drawing, Progress, type Report, type Step } from "./progress";
import type { Questions } from "./questions";
import { DrawnSpinner, QuietSpinner, type Spinner } from "./spinner";
import type { Summary } from "./summary";
import { Where } from "./where";

/**
 * The chain: one command's output from its first line to its last (the package
 * overview in `index.ts` draws one), and the only place `@clack/prompts` is
 * drawn with.
 *
 * Only a wizard has one. It opens itself at the first thing the person sees,
 * so a run that shows nothing draws no frame, and it is closed exactly once,
 * by {@link Chain.finish} or {@link Chain.abort}. A `plain`
 * {@link Presentation} draws no chain however the run goes, and with a
 * non-interactive {@link Audience} nothing is drawn at all; either way
 * narration falls back to plain `consola` lines.
 *
 * A command never opens or closes it: it asks ({@link Chain.questions}), notes
 * what the person must act on, reports its work, and the base command closes
 * the chain on the result the command returned.
 */
export class Chain implements Drawing, Narratable {
  private opened = false;
  private ended = false;
  private title = "zitadel";
  private project: string | undefined;
  private server: string | undefined;
  /** Whether a prompt or a box was the last thing drawn, so the next line needs a blank guide line. */
  private gap = false;
  private readonly audience: Audience;
  private readonly presentation: Presentation;
  private readonly progress = new Progress(this);

  constructor(audience: Audience, presentation: Presentation = "wizard") {
    this.audience = audience;
    this.presentation = presentation;
  }

  /** Whether this command's output is a chain at all. See {@link Presentation}. */
  private get drawsAChain(): boolean {
    return this.presentation === "wizard" && this.audience.interactive;
  }

  describe(title: string): void {
    this.title = title;
  }

  /** Where this command runs, which its summary opens with. */
  ranAgainst(project: string | undefined, server: string | undefined): void {
    this.project = project ?? this.project;
    this.server = server ?? this.server;
  }

  get interactive(): boolean {
    return this.audience.interactive;
  }

  /**
   * Whether this command's output is a chain, so what is drawn into it is
   * drawn in its gutter. It follows the command's {@link Presentation}, as
   * every other shape decision does: a normal command's step is a spinner and
   * a plain line, because a `│` under its answer would make it look like a
   * wizard that happened to do some work.
   */
  get chained(): boolean {
    return this.presentation === "wizard";
  }

  get isOpen(): boolean {
    return this.opened;
  }

  answered(): void {
    this.gap = true;
  }

  closeGap(): void {
    this.gap = false;
  }

  /**
   * One line in the chain: its mark, then the text. A blank guide line first
   * after a prompt.
   *
   * Nothing is drawn with nobody watching, as nothing else is; a normal
   * command says it plainly, so a line of narration cannot grow a gutter
   * around one. Only a chain that is actually being drawn reaches clack —
   * without that, a wizard nobody is watching put a `│` on stdout.
   */
  narrate(symbol: string, text: string): void {
    if (!this.audience.interactive) {
      return;
    }
    if (!this.chained) {
      consola.log(text);
      return;
    }
    this.open();
    // A bridged line is whatever the caller passed `consola`, so it obeys no
    // width of its own: wrapped here, or a long warning runs past the gutter.
    log.message(new Prose(text, WIDTH - GUTTER).render(), {
      symbol,
      spacing: this.gap ? 1 : 0,
    });
    this.gap = false;
  }

  open(): void {
    if (this.drawsAChain && !this.opened) {
      this.opened = true;
      intro(this.title);
    }
  }

  /**
   * Closes the chain, the same way for every command: one line saying what
   * happened, what it produced under it, and, when there is anything to do
   * next, one box of steps. Nothing is wider than {@link WIDTH} columns.
   */
  finish(summary: Summary): void {
    if (this.ended || !this.audience.interactive) {
      return;
    }
    const ending = new Ending(summary, this.where(summary.ran), this.presentation);
    // A normal command draws no chain: its answer stands on its own, with a
    // footer rather than a closing line, however the run went.
    if (ending.standalone) {
      this.ended = true;
      process.stdout.write(ending.renderStandalone());
      return;
    }
    this.open();
    this.ended = true;
    outro(ending.line);
    const below = ending.render();
    if (below !== undefined) {
      process.stdout.write(below);
    }
  }

  /**
   * The same ending as text instead of drawn, for a run nothing is drawn into.
   * The caller decides where it goes, so the chain's own state is left alone.
   */
  ending(summary: Summary): string {
    return new Ending(summary, this.where(summary.ran), this.presentation).render() ?? "";
  }

  /**
   * Ends a run the person stopped, on the one sentence every cancellation
   * ends on ({@link CANCELLED}).
   *
   * A wizard closes its chain: a question the person cancelled has already
   * closed it, so that one is left alone, but an interrupt in the middle of
   * the work has not, and without this the run ends on a bare `┌` and the
   * shell prompt is drawn inside the gutter.
   *
   * A normal command has no chain, and its prompt was left mid-line with the
   * terminal's own `^C` on it, so the shell prompt would otherwise continue
   * that line. It says the same sentence on a line of its own, which is both
   * what makes the two shapes read alike and what makes the plain prompt's
   * silence a decision rather than an omission.
   *
   * A failure is left open on purpose, so that the error block the base
   * command renders through {@link finish} is what closes the chain. Closing
   * it here would make {@link finish} return early and swallow the error,
   * leaving a run that failed showing nothing but its closing line.
   */
  abort(error: unknown): void {
    const cancelled = error instanceof ZitadelError && error.code === "E_CANCELLED";
    if (!cancelled || !this.audience.interactive || this.ended) {
      return;
    }
    if (!this.chained) {
      this.ended = true;
      process.stdout.write(`\n${pc.red(CANCELLED)}\n`);
      return;
    }
    const closedItself = error instanceof ZitadelError && error.message === "Cancelled by user";
    if (closedItself || !this.opened) {
      return;
    }
    this.ended = true;
    outro(pc.red(CANCELLED));
  }

  /**
   * The five questions, asked the way this command presents itself. A wizard's
   * are drawn in its chain: each one opens the chain before its prompt and
   * leaves the blank guide line it needs after it. A normal command's are
   * plain lines, which open nothing and space nothing.
   *
   * `honorForce` false drops this command's `--force` as an answer, for
   * `setup`, whose `--force` means "overwrite files" and so must never answer
   * a question. It is settled per asker rather than kept on the chain, so the
   * command that drops it cannot leave another question dropping it too.
   */
  questions(honorForce: boolean): Questions {
    const session = {
      interactive: this.audience.interactive,
      force: honorForce && this.audience.force,
    };
    return this.presentation === "plain"
      ? plainAsker(session)
      : asker({ ...session, before: () => this.open(), after: () => this.answered() });
  }

  say(text: string): void {
    if (this.drawsAChain) {
      this.narrate(MARK.info, text);
      return;
    }
    consola.info(text);
  }

  note(title: string, lines: readonly string[]): void {
    if (this.drawsAChain) {
      this.open();
      // A box is never wider than 80 columns, so its lines are wrapped to fit.
      note(new Prose(lines.join("\n"), WIDTH - 8).render(), title);
      this.gap = true;
      return;
    }
    for (const line of [title, ...lines]) {
      consola.info(line);
    }
  }

  begin(label: string): Step {
    return this.progress.begin(label);
  }

  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    return this.progress.run(label, work, done);
  }

  /**
   * A spinner the caller stops itself, for work whose shape rules out
   * {@link task}. With nobody watching it is a {@link QuietSpinner}, so the
   * caller never asks whether it may draw.
   *
   * A normal command's spinner keeps out of the gutter and opens nothing:
   * waiting on a page of results is worth saying, and is not a reason for the
   * command to grow a chain around its answer.
   */
  spinner(label: string, options: { guide?: boolean } = {}): Spinner {
    if (!this.audience.interactive) {
      return new QuietSpinner();
    }
    if (this.presentation === "plain") {
      return new DrawnSpinner(label, false);
    }
    this.open();
    return new DrawnSpinner(label, options.guide !== false);
  }

  /** Where this command ran, from what it reported and what its summary knew. */
  private where(ran?: string): Where {
    return new Where(this.project, this.server ?? ran);
  }
}
