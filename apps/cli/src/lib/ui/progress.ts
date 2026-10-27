import { log, spinner } from "@clack/prompts";
import { consola } from "consola";

import { GUIDE, MARK } from "./marks";
import type { Report, Step } from "./wizard";

/**
 * Work in progress, drawn as one line. A spinner runs while the work runs and
 * is replaced by the line that says how it ended, with whatever the work
 * reported underneath. With nobody at a terminal the same thing is narrated as
 * plain `consola` lines, which `--json` silences.
 *
 * Only {@link Chain} calls these; a command reaches them through
 * `wizard.task(...)` or `wizard.begin(...)`.
 */

/** What the chain lends its progress lines: how to draw them in it. */
export type Drawing = {
  readonly interactive: boolean;
  /** Opens the chain, so the first thing drawn is under its heading. */
  open(): void;
  /** The chain's spacing is settled; what follows needs no blank guide line. */
  closeGap(): void;
};

/** Writes one line under a result, in the chain's gutter. */
const detailLine = (text: string): void => {
  log.message(text, { symbol: GUIDE, spacing: 0 });
};

/**
 * A step the caller ends itself, for a run of work the surrounding code cannot
 * wrap in a callback. It ends once: a second `done` or `fail` does nothing.
 */
export function beginStep(drawing: Drawing, label: string): Step {
  if (!drawing.interactive) {
    consola.start(label);
    return {
      detail: (text) => consola.info(text),
      done: (text) => consola.success(text ?? label),
      fail: (text) => consola.error(text ?? `${label} failed`),
    };
  }
  drawing.open();
  const details: string[] = [];
  const progress = spinner();
  progress.start(label);
  let ended = false;
  const end = (symbol: string, text: string) => {
    if (ended) {
      return;
    }
    ended = true;
    progress.clear();
    drawing.closeGap();
    log.message(text, { symbol, spacing: 0 });
    for (const line of details) {
      detailLine(line);
    }
  };
  return {
    detail: (text) => details.push(text),
    done: (text) => end(MARK.done, text ?? label),
    fail: (text) => end(MARK.failed, text ?? `${label} failed`),
  };
}

/**
 * Work as a callback, which is how a command should do it: the step cannot be
 * left unfinished, and what the work reports is listed under its result with
 * the verbs aligned.
 */
export async function runTask<T>(
  drawing: Drawing,
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
  if (!drawing.interactive) {
    consola.start(label);
    const result = await work(report);
    for (const { verb, subject } of lines) {
      consola.info(`${verb} ${subject}`);
    }
    consola.success(done?.(result) ?? label);
    return result;
  }
  drawing.open();
  const progress = spinner();
  progress.start(label);
  try {
    const result = await work(report);
    progress.clear();
    drawing.closeGap();
    // The spinner already drew the blank guide line above the title.
    log.message(done?.(result) ?? label, { symbol: MARK.done, spacing: 0 });
    const width = Math.max(0, ...lines.map((entry) => entry.verb.length));
    for (const { mark, verb, subject } of lines) {
      detailLine(`${mark === "" ? "  " : `${mark} `}${verb.padEnd(width)}  ${subject}`);
    }
    return result;
  } catch (error) {
    progress.clear();
    log.message(`${label} failed`, { symbol: MARK.failed, spacing: 0 });
    throw error;
  }
}
