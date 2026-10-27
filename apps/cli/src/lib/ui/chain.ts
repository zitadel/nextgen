import { intro, log, note, outro } from "@clack/prompts";
import { consola } from "consola";
import pc from "picocolors";

import { ZitadelError } from "../errors";
import { input } from "../input";
import type { Audience } from "./audience";
import { indent, reflow, renderBox, sectionLines, trimBlank, WIDTH } from "./layout";
import type {
  ConfirmQuestion,
  MultiselectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./questions";
import type { Summary } from "./summary";
import { beginStep, type Drawing, runTask } from "./progress";
import type { Report, Step, Wizard } from "./wizard";

/**
 * The chain: one command's output from its first line to its last, and the only
 * place `@clack/prompts` is drawn with.
 *
 *     ┌  Listing origins · proj-1 on api.zitadel.cloud   ← what the command is doing, and where
 *     │
 *     ◇  What should the value of GREETING be?           ← a question, with the answer under it
 *     │  hello
 *     │
 *     ✔  Set GREETING on the project                     ← a step that finished
 *     │  Wrote  .env.local                               ← what that step did
 *     │
 *     └  Set GREETING on the project                     ← the one line the command ends on
 *
 *        primary   hello                                 ← the facts, and then one box of
 *                                                           next steps, both outside the
 *                                                           gutter so they copy cleanly
 *
 * It opens itself at the first thing the person sees, so a run that shows
 * nothing draws no frame, and it is closed exactly once, by {@link Chain.finish}
 * or {@link Chain.abort}. With a non-interactive {@link Audience} it draws
 * nothing at all and narration falls back to plain `consola` lines.
 */
export class Chain implements Wizard {
  private opened = false;
  private ended = false;
  private title = "zitadel";
  private context: string | undefined;
  /** Whether a prompt or a box was the last thing drawn, so the next line needs a blank guide line. */
  private gap = false;
  private readonly audience: Audience;

  constructor(audience: Audience) {
    // Copied: `honorForce` changes it for this command only.
    this.audience = { ...audience };
  }

  describe(title: string | undefined, context?: string): void {
    this.title = title ?? this.title;
    this.context = context ?? this.context;
  }

  honorForce(honor: boolean): void {
    if (!honor) {
      this.audience.force = false;
    }
  }

  get isOpen(): boolean {
    return this.opened;
  }

  answered(): void {
    this.gap = true;
  }

  /** The audience, with the hooks that keep the chain's spacing right around a prompt. */
  private asking(): Audience & { before: () => void; after: () => void } {
    return { ...this.audience, before: () => this.open(), after: () => this.answered() };
  }

  /** One line in the chain: its mark, then the text. A blank guide line first after a prompt. */
  narrate(symbol: string, text: string): void {
    this.open();
    log.message(text, { symbol, spacing: this.gap ? 1 : 0 });
    this.gap = false;
  }

  open(): void {
    if (this.audience.interactive && !this.opened) {
      this.opened = true;
      intro(this.context === undefined ? this.title : `${this.title} ${pc.dim(this.context)}`);
    }
  }

  /**
   * Closes the chain, the same way for every command: one line saying what
   * happened, what it produced under it, and, when there is anything to do
   * next, one box of steps. Nothing is wider than {@link WIDTH} columns.
   */
  finish(summary: Summary): void {
    this.open();
    if (!this.opened || this.ended) {
      return;
    }
    this.ended = true;
    const steps = summary.next ?? [];
    const body = trimBlank([
      ...summary.sections.flatMap((section) => sectionLines(section)),
      ...(summary.lines ?? []),
    ]);
    const boxed = summary.boxed === true || steps.length > 0;

    outro(
      summary.failed === true
        ? pc.red(summary.title)
        : summary.title.replace(/\(server: [^)]+\)$/, (server) => pc.dim(server)),
    );
    if (body.length > 0) {
      process.stdout.write(`${indent(body.join("\n"))}\n`);
    }
    if (boxed && steps.length > 0) {
      process.stdout.write(`\n${renderBox(summary.boxTitle ?? "Next steps", steps)}\n`);
    }
  }

  /** A failure or a cancel. Cancelling already closed the chain (`└  Cancelled.`). */
  abort(error: unknown): void {
    const cancelled = error instanceof ZitadelError && error.message === "Cancelled by user";
    if (this.opened && !this.ended && !cancelled) {
      this.ended = true;
      outro(pc.red("Stopped"));
    }
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

  note(title: string, lines: readonly string[]): void {
    if (this.audience.interactive) {
      this.open();
      // A box is never wider than 80 columns, so its lines are wrapped to fit.
      note(reflow(lines.join("\n"), 72), title);
      this.gap = true;
      return;
    }
    for (const line of [title, ...lines]) {
      consola.info(line);
    }
  }

  begin(label: string): Step {
    return beginStep(this.drawing(), label);
  }

  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    return runTask(this.drawing(), label, work, done);
  }

  /** What {@link beginStep} and {@link runTask} need to draw inside this chain. */
  private drawing(): Drawing {
    return {
      interactive: this.audience.interactive,
      open: () => this.open(),
      closeGap: () => {
        this.gap = false;
      },
    };
  }
}
