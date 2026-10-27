import { intro, log, note, outro } from "@clack/prompts";
import { consola } from "consola";
import pc from "picocolors";

import { ZitadelError } from "../errors";
import { input } from "../input";
import type { Audience } from "./audience";
import { Ending } from "./ending";
import { GUTTER, Prose, WIDTH } from "./layout";
import { MARK } from "./marks";
import type { Narratable } from "./narration";
import { type Drawing, Progress } from "./progress";
import type {
  ConfirmQuestion,
  MultiselectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./questions";
import { DrawnSpinner, QuietSpinner, type Spinner } from "./spinner";
import type { Summary } from "./summary";
import { Where } from "./where";
import type { Report, Step, Wizard } from "./wizard";

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
 * It implements {@link Wizard}, which is all a command is given of it: a
 * command asks, notes and reports work, and never opens or closes the chain
 * it is drawing into.
 */
export class Chain implements Wizard, Drawing, Narratable {
  private opened = false;
  private ended = false;
  private title = "zitadel";
  private project: string | undefined;
  private server: string | undefined;
  /** Whether a prompt or a box was the last thing drawn, so the next line needs a blank guide line. */
  private gap = false;
  private readonly audience: Audience;
  private readonly progress = new Progress(this);
  /**
   * Whether this command's `--force` may answer its confirmations. Separate from
   * the audience, which is the invocation's and not one command's to change.
   */
  private forcing: boolean;

  constructor(audience: Audience) {
    this.audience = audience;
    this.forcing = audience.force;
  }

  describe(title: string): void {
    this.title = title;
  }

  /** Where this command runs, which its summary opens with. */
  ranAgainst(project: string | undefined, server: string | undefined): void {
    this.project = project ?? this.project;
    this.server = server ?? this.server;
  }

  honorForce(honor: boolean): void {
    this.forcing = honor && this.audience.force;
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
   * Closes a chain the run never finished.
   *
   * A question the person cancelled has already closed it (`└  Cancelled.`),
   * so that one is left alone. An interrupt in the middle of the work has
   * not: without this the run ends on a bare `┌` and the shell prompt is
   * drawn inside the gutter.
   */
  abort(error: unknown): void {
    const closedItself = error instanceof ZitadelError && error.message === "Cancelled by user";
    if (!this.audience.interactive || !this.opened || this.ended || closedItself) {
      return;
    }
    this.ended = true;
    const cancelled = error instanceof ZitadelError && error.code === "E_CANCELLED";
    outro(pc.red(cancelled ? "Cancelled" : "Stopped"));
  }

  text<T>(question: TextQuestion<T> & { optional: true }): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  text<T>(question: TextQuestion<T> & { optional?: true }): Promise<T | undefined> {
    this.open();
    return input({ kind: "text", ...question }, this.asking()) as Promise<T | undefined>;
  }

  secret<T>(question: SecretQuestion<T> & { optional: true }): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  secret<T>(question: SecretQuestion<T> & { optional?: true }): Promise<T | undefined> {
    this.open();
    return input({ kind: "secret", ...question }, this.asking()) as Promise<T | undefined>;
  }

  select<V>(question: SelectQuestion<V>): Promise<V> {
    this.open();
    return input({ kind: "select", ...question }, this.asking()) as Promise<V>;
  }

  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]> {
    this.open();
    return input({ kind: "multiselect", ...question }, this.asking()) as Promise<V[]>;
  }

  confirm(question: ConfirmQuestion): Promise<boolean> {
    this.open();
    return input({ kind: "confirm", ...question }, this.asking());
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

  /**
   * The audience a question is asked of: this command's `--force` rather than
   * the invocation's, with the hooks that open the chain before a prompt is
   * drawn and leave the blank guide line it needs after it.
   */
  private asking(): Audience & { before: () => void; after: () => void } {
    return {
      ...this.audience,
      force: this.forcing,
      before: () => this.open(),
      after: () => this.answered(),
    };
  }
}
