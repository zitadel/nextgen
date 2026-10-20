import type { Writable } from "node:stream";
import { styleText } from "node:util";

import type { Asker } from "../input";

import { Rail, visibleLength } from "./rail";

/** What a message means, and so what colour its mark is. */
export type Tone = "info" | "warn" | "success";

const TONE_COLOUR = { info: "cyan", warn: "yellow", success: "green" } as const;

/** One cell of a table: its text, and optionally a tone to colour it with. */
export type Cell = string | { readonly text: string; readonly tone: Tone | "muted" };

type Target = Writable & { columns?: number; rows?: number; isTTY?: boolean };

type Question = Parameters<Asker>[0];

/**
 * Thrown by {@link Wizard.ask} when the person chooses to go back. A flow lets
 * it travel up to the {@link Wizard.steps} run that can re-ask the previous
 * question; nothing else should catch it.
 */
export class GoBack extends Error {
  constructor() {
    super("go back");
    this.name = "GoBack";
  }
}

/** What a "go back" answer is, before it is turned into {@link GoBack}. */
const BACK = Symbol("wizard.back");

/** The text a person types to go back from a question that takes text. */
const BACK_TEXT = "<";

/** One step of a flow: it asks what it needs and returns the state with the answers in. */
export type Step<S> = (state: S) => Promise<S>;

type Remembered = { index: number; state: unknown; answers: Map<string, unknown> };

/**
 * A small framework for interactive flows that talk to a person, built on the
 * prompts the CLI already uses.
 *
 * A flow is a left rail of questions, with messages and tables between them
 * and branches that indent a group of related questions:
 *
 * ```
 * ◇  Add sign-in with another service?
 * │  Google
 * │
 * ├─●  Configuring the new provider
 * │  │
 * │  ◇  What should this connection be called?
 * │  │  corp-sso
 * │  │
 * │  ●  "Corp SSO" needs an OAuth application.
 * ```
 *
 * It owns presentation only: what to ask and what to do with the answers stays
 * with the command. Questions go through the same `Asker` the commands use, so
 * they behave like every other question the CLI asks, and a branch only changes
 * where they are drawn. Nothing here knows about identity providers, so it can
 * carry any command's flow.
 */
export class Wizard {
  private readonly rail: Rail;
  private readonly target: Target;
  private readonly base: Asker;
  /** Questions drawn so far, so a step that asked nothing is known not to be a place to go back to. */
  private asked = 0;
  /** Whether going back is possible from the step running, innermost last. */
  private readonly backAllowed: boolean[] = [];
  /** What the running step has been answered, kept so that going back can show it again. */
  private answers = new Map<string, unknown>();
  /** Answers to show again after going back, by question name. */
  private prefill = new Map<string, unknown>();

  /**
   * @param options.ask - The CLI's asker, with its session already filled in.
   * @param options.output - Where to draw. The terminal unless a test says otherwise.
   */
  constructor(options: { ask: Asker; output?: Target }) {
    this.base = options.ask;
    this.target = options.output ?? process.stdout;
    this.rail = new Rail(this.target);
  }

  /**
   * Ask a question, drawn under the branch the flow is in. Inside a
   * {@link steps} run that has somewhere to go back to, a select gains a "Go
   * back" option and a text question takes `<`; choosing either throws
   * {@link GoBack}. A question that comes pre-answered from a flag is never
   * drawn, so it is never offered a way back.
   */
  readonly ask: Asker = (async (question: Question) => {
    const answer = await this.base({ ...this.prepared(question), output: this.rail.stream });
    this.asked += 1;
    if (answer === BACK) {
      throw new GoBack();
    }
    this.answers.set(question.name, answer);
    return answer;
  }) as Asker;

  /** How deep the flow is: zero at the top, one more inside each branch. */
  get depth(): number {
    return this.rail.depth;
  }

  /** Text in a tone, coloured only when the terminal shows colour. */
  style(tone: Tone | "muted" | "heading", text: string): string {
    const format = tone === "muted" ? "gray" : tone === "heading" ? "bold" : TONE_COLOUR[tone];
    return styleText(format, text, { stream: this.target });
  }

  /**
   * A message on the rail. The first line carries the mark, the rest hang
   * under it, and an empty line keeps the rail unbroken.
   */
  say(lines: string | readonly string[], tone: Tone = "info"): void {
    const [first = "", ...rest] = typeof lines === "string" ? [lines] : lines;
    const rail = this.style("muted", "│");
    this.write([
      rail,
      `${this.style(tone, "●")}  ${first}`,
      ...rest.map((line) => (line === "" ? rail : `${rail}  ${line}`)),
    ]);
  }

  /**
   * A table as lines, columns aligned on what is visible so colour does not
   * throw them off. The header is bold; a cell may carry a tone.
   */
  table(columns: readonly string[], rows: readonly (readonly Cell[])[]): string[] {
    const text = (cell: Cell): string => (typeof cell === "string" ? cell : cell.text);
    const shown = (cell: Cell): string =>
      typeof cell === "string" ? cell : this.style(cell.tone, cell.text);
    const widths = columns.map((column, at) =>
      Math.max(visibleLength(column), ...rows.map((row) => visibleLength(text(row[at] ?? "")))),
    );
    const pad = (value: string, width: number): string =>
      value + " ".repeat(Math.max(0, width - visibleLength(value)));
    const line = (cells: readonly string[]): string =>
      `  ${cells.map((cell, at) => pad(cell, widths[at] ?? 0)).join("    ")}`.trimEnd();
    return [
      line(columns.map((column) => this.style("heading", column))),
      ...rows.map((row) => line(columns.map((_, at) => shown(row[at] ?? "")))),
    ];
  }

  /**
   * Open a branch, run its questions indented under it, and close it. The
   * title says what is happening and names nothing the person has not yet
   * typed. The branch is closed even if a question is cancelled.
   */
  async branch<T>(title: string, body: () => Promise<T>): Promise<T> {
    const rail = this.style("muted", "│");
    this.write([rail, `${this.style("muted", "├─")}${this.style("info", "●")}  ${title}`]);
    this.rail.push(`${rail}  `);
    try {
      return await body();
    } finally {
      this.rail.pop();
    }
  }

  /**
   * Run a flow as a list of steps a person can step back through.
   *
   * Each step asks what it needs and returns the state with its answers in.
   * Going back from a step re-runs the previous one that asked something, with
   * its earlier answers shown again and the state as it was before that step,
   * so a step never sees answers from a path that was abandoned. Going back from
   * the first step passes to the run around this one, if there is one.
   */
  async steps<S>(initial: S, steps: readonly Step<S>[]): Promise<S> {
    const history: Remembered[] = [];
    const parentAllows = this.backAllowed.at(-1) === true;
    const outerAnswers = this.answers;
    let state = initial;
    let index = 0;
    try {
      while (index < steps.length) {
        const before = this.asked;
        const snapshot = state;
        this.answers = new Map();
        this.backAllowed.push(history.length > 0 || parentAllows);
        try {
          state = await (steps[index] as Step<S>)(state);
        } catch (error) {
          const previous = error instanceof GoBack ? history.pop() : undefined;
          if (previous === undefined) {
            throw error;
          }
          this.say("Going back.");
          index = previous.index;
          state = previous.state as S;
          this.prefill = previous.answers;
          continue;
        } finally {
          this.backAllowed.pop();
        }
        if (this.asked > before) {
          history.push({ index, state: snapshot, answers: this.answers });
        }
        this.prefill = new Map();
        index += 1;
      }
      return state;
    } finally {
      this.answers = outerAnswers;
    }
  }

  /** The question as it is drawn: with a way back, and with an earlier answer in it. */
  private prepared(question: Question): Question {
    const given = "given" in question ? question.given : undefined;
    const back = this.backAllowed.at(-1) === true && given === undefined;
    const earlier = this.prefill.get(question.name);
    if (question.kind === "select") {
      return {
        ...question,
        ...(earlier === undefined ? {} : { initialValue: earlier }),
        options: back ? [...question.options, { value: BACK, label: "Go back" }] : question.options,
      };
    }
    if (question.kind === "text" || question.kind === "secret") {
      const parse = question.parse;
      return {
        ...question,
        ...(earlier === undefined ||
        question.kind === "secret" ||
        question.initialValue !== undefined
          ? {}
          : { initialValue: String(earlier) }),
        ...(back
          ? {
              message: `${question.message} ${this.style("muted", `(${BACK_TEXT} goes back)`)}`,
              parse: (value: string) =>
                value.trim() === BACK_TEXT ? { ok: true as const, value: BACK } : parse(value),
            }
          : {}),
      };
    }
    return question;
  }

  private write(lines: readonly string[]): void {
    this.rail.stream.write(`${lines.join("\n")}\n`);
  }
}
