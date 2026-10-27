import { intro, log, note, outro, spinner } from "@clack/prompts";
import { consola, type ConsolaReporter } from "consola";
import { box } from "consola/utils";
import { format } from "node:util";
import pc from "picocolors";

import type { Parsed } from "@zitadel/config/idp";

import wrapAnsi from "wrap-ansi";

import type { BoxAction } from "./box";
import { ZitadelError } from "./errors";
import { input } from "./input";
import type { SuggestedCommand } from "./suggestion";

/*
 * The one module that prints. Nothing else imports @clack/prompts or consola.
 *
 * Every command that talks to a person draws the same chain. Each kind of line
 * has its own mark, so one can tell what you are looking at:
 *
 *     ┌  zitadel variable set
 *     │
 *     ◇  What should the value of GREETING be?     ← a QUESTION (◇), and under it the answer
 *     │  hello
 *     │
 *     ✔  Set GREETING on the project               ← a STEP that was done (✔)
 *     │  primary   hello                           ← what that step did
 *     │
 *     └  GREETING is set                            ← the headline that closes the chain
 *
 *        Project   proj-1083f2c9fe7e               ← then the facts and what to run next, plain,
 *                                                     so a command can be copied without a border
 *
 * A boxed note exists for one thing only: something the person must go and do
 * outside the terminal (register an OAuth app). There is no free-form log.
 */

// ── Questions ───────────────────────────────────────────────────────────────

/** One option of a `select` or `multiselect`. */
export type Choice<V> = { value: V; label: string; hint?: string };

type Question = {
  /** What is asked for, as a lowercase noun phrase ("client id"), for the refusal. */
  name: string;
  /** The question, worded as a polite question. */
  message: string;
  /** The flag that carries this value, when there is one. */
  flag?: string;
  /** The command to run again with the missing input, for an agent. */
  retry?: SuggestedCommand;
};

export type TextQuestion<T> = Question & {
  parse: (raw: string) => Parsed<T>;
  given?: string;
  stdin?: boolean;
  initialValue?: string;
  placeholder?: string;
};
type SecretQuestion<T> = Omit<TextQuestion<T>, "flag" | "given">;

export type SelectQuestion<V> = Question & { options: Choice<V>[]; initialValue?: V };
export type MultiselectQuestion<V> = Question & { options: Choice<V>[]; required?: boolean };
export type ConfirmQuestion = Question & { initialValue?: boolean };

// ── What a task reports ─────────────────────────────────────────────────────

/**
 * What a task tells the person, one line each. The verb and the subject are
 * passed apart so every command's lines look alike: `✔ Wrote  path`.
 */
export interface Report {
  /** Something was done: `Wrote  .zitadel/idps/google.json`, listed under its step. */
  done(verb: string, subject: string): void;
  /** Something was left alone on purpose: `– Left  flows/default-login.json (edited by hand)`. */
  skipped(verb: string, subject: string): void;
  /** Something to look at: `! Check  no claim_mapping`. */
  warning(verb: string, subject: string): void;
}

/** What a wizard offers. Every method is one component; there are no kind strings. */
export interface Wizard {
  /** Free text. With `optional: true`, `undefined` when nothing was given. */
  text<T>(question: TextQuestion<T> & { optional: true }): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  /** Masked text, never a flag, never echoed. */
  secret<T>(question: SecretQuestion<T> & { optional: true }): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  select<V>(question: SelectQuestion<V>): Promise<V>;
  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]>;
  /** Yes or no. The command's `--force` answers it yes without asking. */
  confirm(question: ConfirmQuestion): Promise<boolean>;
  /** Something the person has to read or do, such as where to register an OAuth app. */
  note(title: string, lines: readonly string[]): void;
  /**
   * Work that takes a moment: a spinner while `work` runs, then `done`'s result
   * (or `label`) as the task's title, with whatever `work` reported under it.
   */
  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T>;
}

// ── Summary ─────────────────────────────────────────────────────────────────

/** `label   value`, aligned with its neighbours. */
export type Fact = readonly [label: string, value: string];

export type Section = { heading?: string; facts: readonly Fact[] };

/** Builds a section: `section("Project", ["Id", id], ["Server", url])`. */
export const section = (heading: string | undefined, ...facts: Fact[]): Section => ({
  ...(heading === undefined ? {} : { heading }),
  facts,
});

/**
 * What a command ends on. It says what is true now and what to do next; it does
 * not repeat the lines the tasks already reported.
 */
export type Summary = {
  /** The headline, which closes the chain: `└  Google sign-in is configured`. */
  title: string;
  sections: readonly Section[];
  /** Free-form lines under the facts, such as a table a list command prints. */
  lines?: readonly string[];
  /** The command failed: the headline closes the chain in red. */
  failed?: boolean;
  /** What to run next. */
  next?: readonly BoxAction[];
  /** Draw the report as a bordered box under the closing line, as `setup` does. */
  boxed?: boolean;
  /** Plain text under the box, outside it, so a command in it can be copied without a border. */
  footer?: string;
  /** Lines between the closing line and the box. */
  above?: readonly string[];
  /** The box's own title when the headline stays on the closing line (otherwise the headline is it). */
  boxTitle?: string;
};

/**
 * What a wizard's steps return. `data` is the `--json` envelope's payload;
 * `summary` is what a person sees. Requiring both is how every command is made
 * to end the same way.
 */
export type Outcome<D> = { data: D; summary: Summary };

export const outcome = <D>(data: D, summary: Summary): Outcome<D> => ({ data, summary });

/** One stretch of work, begun with `ui.begin` and ended with `done` or `fail`. */
export interface Step {
  /** A line of detail, such as one file written. It is listed under the step's result. */
  detail(text: string): void;
  /** Ends the step with its result as the title. */
  done(text?: string): void;
  /** Ends the step as failed. The error itself is shown by the command's ending. */
  fail(text?: string): void;
}

// ── The UI a command gets as `this.ui` ──────────────────────────────────────

/** Who can answer. `interactive` is false under `--json`, `--non-interactive` and no terminal. */
export type Audience = { interactive: boolean; force: boolean; verbose?: boolean };

export class Ui {
  private readonly audience: Audience;
  private readonly chain: Chain;

  constructor(audience: Audience) {
    this.audience = audience;
    this.chain = new Chain(audience);
  }

  /** Whether anything is drawn: false under `--json`, `--non-interactive` and no terminal. */
  get interactive(): boolean {
    return this.audience.interactive;
  }

  /** Whether the chain has been drawn into. */
  get opened(): boolean {
    return this.chain.isOpen;
  }

  /** Names the chain by what it is doing: `Listing origins of`, then where it runs. */
  describe(title: string, alone?: string): void {
    this.chain.describe(title, undefined, alone);
  }

  /** Where the command runs, for the chain's title. Replaces the `ℹ Project / ℹ Server` lines. */
  context(context: string): void {
    this.chain.describe(undefined, context);
  }

  /**
   * Draws what the rest of the CLI still says through `consola` inside the chain,
   * with its gutter and one mark per kind, so a command that has not been moved
   * to steps and tasks yet still looks like the others. Does nothing when nobody
   * is at a terminal: consola keeps printing its own lines then.
   */
  bridgeNarration(): void {
    if (!this.audience.interactive) {
      return;
    }
    const marks: Record<string, string> = {
      success: MARK.done,
      ready: MARK.done,
      info: pc.cyan("ℹ"),
      start: pc.cyan("◐"),
      warn: MARK.warning,
      error: pc.red("✖"),
      fail: pc.red("✖"),
      fatal: pc.red("✖"),
      debug: pc.dim("·"),
      trace: pc.dim("·"),
    };
    const reporter: ConsolaReporter = {
      log: (entry) => {
        const text = format(...entry.args);
        if (text.trim() === "") {
          return;
        }
        this.chain.narrate(marks[entry.type] ?? GUIDE, text.replace(/^\n+/, ""));
      },
    };
    consola.setReporters([reporter]);
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

/** The widest anything the CLI draws may be, however wide the terminal is. */
const WIDTH = 80;

/** Everything under the closing line is indented to clear the chain's gutter. */
const indent = (text: string): string => text.replace(/^(?=.)/gm, "   ");

const trimBlank = (lines: readonly string[]): string[] => {
  const out = [...lines];
  while (out[0]?.trim() === "") {
    out.shift();
  }
  while (out.at(-1)?.trim() === "") {
    out.pop();
  }
  return out;
};

const sectionLines = (section: Section): string[] => {
  const width = Math.max(0, ...section.facts.map(([label]) => label.length));
  return [
    ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
    ...section.facts.map(([label, value]) => `${pc.dim(label.padEnd(width))}   ${value}`),
    "",
  ];
};

/**
 * The one box the CLI draws: a fixed {@link WIDTH} frame of steps, each a
 * sentence and, under it, the commands it asks for, indented and highlighted.
 * Every command's box is the same width and lays its steps out the same way.
 */
function renderBox(title: string, steps: readonly BoxAction[]): string {
  const inner = WIDTH - 6;
  const body = steps
    .map((step) =>
      [
        reflow(step.text, inner),
        ...(step.command === undefined
          ? []
          : step.command.split("\n").map((command) => `  ${pc.bold(pc.cyan(command))}`)),
      ].join("\n"),
    )
    .join("\n\n");
  // Not `consola.box`: while a chain is open consola's output is drawn inside it.
  // The last line is padded so every box is the same width, which consola
  // otherwise sizes to its content.
  const lines = body.split("\n");
  const last = lines.length - 1;
  lines[last] = (lines[last] ?? "").padEnd(inner);
  return box(lines.join("\n"), {
    title,
    style: { padding: 1, borderStyle: "rounded", borderColor: "green", marginTop: 0 },
  });
}

const GUIDE = pc.gray("│");
const MARK = {
  done: pc.green("✔"),
  skipped: pc.dim("–"),
  warning: pc.yellow("!"),
};

class Chain implements Wizard {
  private opened = false;
  private ended = false;
  private title = "zitadel";
  private context: string | undefined;
  /** What the command is doing when it runs nowhere in particular. */
  private alone: string | undefined;
  /** Whether a prompt or a box was the last thing drawn, so the next line needs a blank guide line. */
  private gap = false;
  private readonly audience: Audience;

  constructor(audience: Audience) {
    // Copied: `honorForce` changes it for this command only.
    this.audience = { ...audience };
  }

  describe(title: string | undefined, context?: string, alone?: string): void {
    this.title = title ?? this.title;
    this.context = context ?? this.context;
    this.alone = alone ?? this.alone;
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
      intro(
        this.context === undefined ? (this.alone ?? this.title) : `${this.title} ${this.context}`,
      );
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
    const details: string[] = [];
    if (!this.audience.interactive) {
      consola.start(label);
      return {
        detail: (text) => consola.info(text),
        done: (text) => consola.success(text ?? label),
        fail: (text) => consola.error(text ?? `${label} failed`),
      };
    }
    this.open();
    const progress = spinner();
    progress.start(label);
    let ended = false;
    const end = (symbol: string, text: string) => {
      if (ended) {
        return;
      }
      ended = true;
      progress.clear();
      this.gap = false;
      log.message(text, { symbol, spacing: 0 });
      for (const line of details) {
        log.message(line, { symbol: GUIDE, spacing: 0 });
      }
    };
    return {
      detail: (text) => details.push(text),
      done: (text) => end(MARK.done, text ?? label),
      fail: (text) => end(pc.red("✖"), text ?? `${label} failed`),
    };
  }

  async task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    const lines: { mark: string; verb: string; subject: string }[] = [];
    const line = (mark: string) => (verb: string, subject: string) => {
      lines.push({ mark, verb, subject });
    };
    const report: Report = {
      done: line(""),
      skipped: line(MARK.skipped),
      warning: line(MARK.warning),
    };
    if (!this.audience.interactive) {
      // Nobody at a terminal: the same narration the CLI always had, which
      // `--json` silences (consola's level).
      consola.start(label);
      const result = await work(report);
      for (const { verb, subject } of lines) {
        consola.info(`${verb} ${subject}`);
      }
      consola.success(done?.(result) ?? label);
      return result;
    }
    this.open();
    const progress = spinner();
    progress.start(label);
    try {
      const result = await work(report);
      progress.clear();
      this.gap = false;
      // The spinner already drew the blank guide line above the title.
      log.message(done?.(result) ?? label, { symbol: MARK.done, spacing: 0 });
      const verbWidth = Math.max(0, ...lines.map((l) => l.verb.length));
      for (const { mark, verb, subject } of lines) {
        const prefix = mark === "" ? "  " : `${mark} `;
        log.message(`${prefix}${verb.padEnd(verbWidth)}  ${subject}`, {
          symbol: GUIDE,
          spacing: 0,
        });
      }
      return result;
    } catch (error) {
      progress.clear();
      log.message(`${label} failed`, { symbol: pc.red("✖"), spacing: 0 });
      throw error;
    }
  }
}

/**
 * Wraps prose to `width`, giving a wrapped line the indent of its first line (plus
 * two for a list item, `[ok] …` or `$ …`). A line laid out in columns, such as a
 * table row, is left whole, because breaking it would break the columns.
 */
export function reflow(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => {
      if (/\S {2,}\S/.test(line) || line.length <= width) {
        return line;
      }
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const item = /^(\[\w+\]|\$|-|\d+\.) /.test(line.trimStart()) ? "  " : "";
      return wrapAnsi(line.trimStart(), width - indent.length - item.length)
        .split("\n")
        .map((part, i) => (i === 0 ? indent : indent + item) + part)
        .join("\n");
    })
    .join("\n");
}
