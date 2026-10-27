import { log } from "@clack/prompts";
import { consola } from "consola";

import { GUTTER, Prose, WIDTH } from "./layout";
import { GUIDE, MARK } from "./marks";
import { DrawnSpinner } from "./spinner";
import type { Report, Step } from "./wizard";

/**
 * Work in progress, drawn as one line. A spinner runs while the work runs and
 * is replaced by the line that says how it ended, with whatever the work
 * reported underneath. With nobody at a terminal the same thing is narrated as
 * plain `consola` lines, which `--json` silences.
 *
 * Only the chain builds one; a command reaches it through `wizard.task(...)`
 * or `wizard.begin(...)`.
 */

/**
 * What the chain lends its progress lines: how to draw them in it. The chain
 * implements it, rather than handing over itself, so progress can open and
 * space the chain and do nothing else to it.
 */
export interface Drawing {
  /** Whether a person is watching. When false nothing is drawn, only narrated. */
  readonly interactive: boolean;
  /** Opens the chain, so the first thing drawn is under its heading. */
  open(): void;
  /** The chain's spacing is settled; what follows needs no blank guide line. */
  closeGap(): void;
}

/** One line a task reported, waiting to be drawn with its verbs aligned. */
type Line = { mark: string; verb: string; subject: string };

/**
 * Draws the progress of one chain's work. It is a class rather than two loose
 * functions because both ways of reporting work — the callback and the
 * hand-ended step — need the same chain, the same marks and the same alignment,
 * and the only difference between them is who decides that the work is over.
 */
export class Progress {
  private readonly drawing: Drawing;

  constructor(drawing: Drawing) {
    this.drawing = drawing;
  }

  /**
   * Work as a callback, which is how a command should do it: the step cannot be
   * left unfinished, and what the work reports is listed under its result with
   * the verbs aligned.
   */
  async run<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T> {
    const lines: Line[] = [];
    const report = Progress.collect(lines);
    if (!this.drawing.interactive) {
      consola.start(label);
      const result = await work(report);
      for (const { verb, subject } of lines) {
        consola.info(`${verb} ${subject}`);
      }
      consola.success(done?.(result) ?? label);
      return result;
    }
    this.drawing.open();
    const progress = new DrawnSpinner(label);
    try {
      const result = await work(report);
      progress.clear();
      this.drawing.closeGap();
      // The spinner already drew the blank guide line above the title.
      Progress.line(MARK.done, done?.(result) ?? label);
      Progress.draw(lines);
      return result;
    } catch (error) {
      progress.clear();
      Progress.line(MARK.failed, `${label} failed`);
      throw error;
    }
  }

  /**
   * A step the caller ends itself, for a run of work the surrounding code
   * cannot wrap in a callback. It ends once: a second `done` or `fail` does
   * nothing.
   */
  begin(label: string): Step {
    if (!this.drawing.interactive) {
      consola.start(label);
      // Ending once is the step's contract, not the chain's: a caller that
      // ends its own step in both a `try` and a `catch` must not narrate the
      // step twice just because nobody is watching.
      let narrated = false;
      const once = (narrate: () => void) => {
        if (narrated) {
          return;
        }
        narrated = true;
        narrate();
      };
      return {
        detail: (text) => consola.info(text),
        done: (text) => once(() => consola.success(text ?? label)),
        fail: (text) => once(() => consola.error(text ?? `${label} failed`)),
      };
    }
    this.drawing.open();
    const details: string[] = [];
    const progress = new DrawnSpinner(label);
    let ended = false;
    const end = (symbol: string, text: string) => {
      if (ended) {
        return;
      }
      ended = true;
      progress.clear();
      this.drawing.closeGap();
      Progress.line(symbol, text);
      for (const line of details) {
        Progress.detail(line);
      }
    };
    return {
      detail: (text) => details.push(text),
      done: (text) => end(MARK.done, text ?? label),
      fail: (text) => end(MARK.failed, text ?? `${label} failed`),
    };
  }

  /** A {@link Report} that remembers what it was told, in the order it was told. */
  private static collect(lines: Line[]): Report {
    const line = (mark: string) => (verb: string, subject: string) => {
      lines.push({ mark, verb, subject });
    };
    return { done: line(""), skipped: line(MARK.skipped), warning: line(MARK.warning) };
  }

  /** What a task reported, under its result, with the verbs in one column. */
  private static draw(lines: readonly Line[]): void {
    const width = Math.max(0, ...lines.map((entry) => entry.verb.length));
    for (const { mark, verb, subject } of lines) {
      Progress.detail(`${mark === "" ? "  " : `${mark} `}${verb.padEnd(width)}  ${subject}`);
    }
  }

  /** Writes one line under a result, in the chain's gutter. */
  private static detail(text: string): void {
    Progress.line(GUIDE, text);
  }

  /**
   * One line in the chain, wrapped to what the gutter leaves of the terminal.
   * A step names whatever it did — a sentence and a path, say — so without
   * this a long one runs past the chain instead of folding under it. A line
   * already laid out in columns is left whole by {@link Prose}.
   */
  private static line(symbol: string, text: string): void {
    log.message(new Prose(text, WIDTH - GUTTER).render(), { symbol, spacing: 0 });
  }
}
