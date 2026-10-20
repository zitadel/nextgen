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

  /**
   * @param options.ask - The CLI's asker, with its session already filled in.
   * @param options.output - Where to draw. The terminal unless a test says otherwise.
   */
  constructor(options: { ask: Asker; output?: Target }) {
    this.base = options.ask;
    this.target = options.output ?? process.stdout;
    this.rail = new Rail(this.target);
  }

  /** Ask a question, drawn under the branch the flow is in. */
  readonly ask: Asker = (question) => this.base({ ...question, output: this.rail.stream });

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

  private write(lines: readonly string[]): void {
    this.rail.stream.write(`${lines.join("\n")}\n`);
  }
}
