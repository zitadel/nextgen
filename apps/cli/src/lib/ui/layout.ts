import { box } from "consola/utils";
import pc from "picocolors";
import wrapAnsi from "wrap-ansi";

import type { BoxAction } from "../box";
import type { Section } from "./summary";

/**
 * How the CLI's output is laid out: the width everything fits in, the indent
 * under the chain's gutter, and the one box the CLI draws. These are pure
 * string functions, so what the terminal ends up looking like can be asserted
 * in a unit test without a terminal.
 */

/** The widest anything the CLI draws may be, however wide the terminal is. */
export const WIDTH = 80;

/** Everything under the closing line clears the chain's gutter by this much. */
export const indent = (text: string): string => text.replace(/^(?=.)/gm, "   ");

/** Drops the blank lines a command's own rendering leaves at either end. */
export function trimBlank(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out[0]?.trim() === "") {
    out.shift();
  }
  while (out.at(-1)?.trim() === "") {
    out.pop();
  }
  return out;
}

/** A section as lines: its heading, then its facts in two aligned columns. */
export function sectionLines(section: Section): string[] {
  const width = Math.max(0, ...section.facts.map(([label]) => label.length));
  return [
    ...(section.heading === undefined ? [] : [pc.bold(section.heading)]),
    ...section.facts.map(([label, value]) => `${pc.dim(label.padEnd(width))}   ${value}`),
    "",
  ];
}

/**
 * Wraps prose to `width`, giving a wrapped line the indent of its first line,
 * plus two more for a list item (`[ok] …`, `$ …`, `- …`), so what belongs to
 * one item stays visibly under it. A line laid out in columns, such as a table
 * row, is left whole: breaking it would break the columns.
 */
export function reflow(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => {
      if (/\S {2,}\S/.test(line) || line.length <= width) {
        return line;
      }
      const lead = /^\s*/.exec(line)?.[0] ?? "";
      const item = /^(\[\w+\]|\$|-|\d+\.) /.test(line.trimStart()) ? "  " : "";
      return wrapAnsi(line.trimStart(), width - lead.length - item.length)
        .split("\n")
        .map((part, index) => (index === 0 ? lead : lead + item) + part)
        .join("\n");
    })
    .join("\n");
}

/**
 * The one box the CLI draws: a {@link WIDTH}-wide frame of steps, each a
 * sentence and, under it, the commands it asks for. Every command's box is the
 * same width and lays its steps out the same way, so two commands' next steps
 * are comparable at a glance.
 *
 * A step's sentence is wrapped to fit; its commands are not. A command broken
 * across lines cannot be copied, so one longer than the frame widens it.
 */
export function renderBox(title: string, steps: readonly BoxAction[]): string {
  const inner = WIDTH - 7;
  const lines = steps
    .map((step) =>
      [
        reflow(step.text, inner),
        ...(step.command === undefined
          ? []
          : step.command.split("\n").map((command) => `  ${pc.bold(pc.cyan(command))}`)),
      ].join("\n"),
    )
    .join("\n\n")
    .split("\n");
  // Not `consola.box`: while a chain is open, consola's own output is drawn
  // inside it. The last line is padded so every box is the same width, which
  // consola otherwise sizes to its content.
  const last = lines.length - 1;
  lines[last] = (lines[last] ?? "").padEnd(inner);
  return box(lines.join("\n"), {
    title,
    style: { padding: 1, borderStyle: "rounded", borderColor: "green", marginTop: 0 },
  });
}
