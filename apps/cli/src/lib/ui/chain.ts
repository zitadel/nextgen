import { intro, log, note, outro } from "@clack/prompts";
import { consola } from "consola";
import pc from "picocolors";

import { ZitadelError } from "../errors";
import { asker } from "../input";
import type { Audience } from "./audience";
import { Ending } from "./ending";
import { GUTTER, Prose, WIDTH } from "./layout";
import { MARK } from "./marks";
import type { Narratable } from "./narration";
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
 * It opens itself at the first thing the person sees, so a run that shows
 * nothing draws no frame, and it is closed exactly once, by {@link Chain.finish}
 * or {@link Chain.abort}. With a non-interactive {@link Audience} it draws
 * nothing at all and narration falls back to plain `consola` lines.
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
  private readonly progress = new Progress(this);

  constructor(audience: Audience) {
    this.audience = audience;
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

  get isOpen(): boolean {
    return this.opened;
  }

  answered(): void {
    this.gap = true;
  }

  closeGap(): void {
    this.gap = false;
  }

  /** One line in the chain: its mark, then the text. A blank guide line first after a prompt. */
  narrate(symbol: string, text: string): void {
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
    if (this.audience.interactive && !this.opened) {
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
    const ending = new Ending(summary, this.where(summary.ran), this.opened);
    // A command that answered without asking anything draws no chain: its
    // answer stands on its own, with a footer rather than a closing line.
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
    return new Ending(summary, this.where(summary.ran), this.opened).render() ?? "";
  }

  /**
   * Closes a chain the run never finished, which is only ever a cancellation.
   *
   * A question the person cancelled has already closed it (`└  Cancelled.`),
   * so that one is left alone. An interrupt in the middle of the work has
   * not: without this the run ends on a bare `┌` and the shell prompt is
   * drawn inside the gutter.
   *
   * A failure is left open on purpose, so that the error block the base
   * command renders through {@link finish} is what closes the chain. Closing
   * it here would make {@link finish} return early and swallow the error,
   * leaving a run that failed showing nothing but its closing line.
   */
  abort(error: unknown): void {
    const cancelled = error instanceof ZitadelError && error.code === "E_CANCELLED";
    const closedItself = error instanceof ZitadelError && error.message === "Cancelled by user";
    if (!cancelled || closedItself || !this.audience.interactive || !this.opened || this.ended) {
      return;
    }
    this.ended = true;
    outro(pc.red("Cancelled"));
  }

  /**
   * The five questions, bound to this chain: each one opens the chain before
   * its prompt is drawn and leaves the blank guide line it needs after it.
   *
   * `honorForce` false drops this command's `--force` as an answer, for
   * `setup`, whose `--force` means "overwrite files" and so must never answer
   * a question. It is settled per asker rather than kept on the chain, so the
   * command that drops it cannot leave another question dropping it too.
   */
  questions(honorForce: boolean): Questions {
    return asker({
      interactive: this.audience.interactive,
      force: honorForce && this.audience.force,
      before: () => this.open(),
      after: () => this.answered(),
    });
  }

  say(text: string): void {
    if (this.audience.interactive) {
      this.narrate(MARK.info, text);
      return;
    }
    consola.info(text);
  }

  note(title: string, lines: readonly string[]): void {
    if (this.audience.interactive) {
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
   */
  spinner(label: string, options: { guide?: boolean } = {}): Spinner {
    if (!this.audience.interactive) {
      return new QuietSpinner();
    }
    this.open();
    return new DrawnSpinner(label, options.guide !== false);
  }

  /** Where this command ran, from what it reported and what its summary knew. */
  private where(ran?: string): Where {
    return new Where(this.project, this.server ?? ran);
  }
}
