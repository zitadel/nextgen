import type { BoxAction } from "../box";

/**
 * How a command ends. Every command ends the same way: one line saying what
 * happened, what it produced under that line, and, when there is anything to
 * do next, one box of steps.
 *
 * A command does not print its ending. It returns it, so that the layout is
 * decided in one place and a command cannot forget to end.
 */

/** `label   value`, aligned with its neighbours in the same section. */
export type Fact = readonly [label: string, value: string];

/** A group of facts under an optional heading. */
export type Section = { readonly heading?: string; readonly facts: readonly Fact[] };

/**
 * Builds a section.
 *
 * @example
 * section("Project", ["Id", project.id], ["Server", server])
 */
export const section = (heading: string | undefined, ...facts: Fact[]): Section => ({
  ...(heading === undefined ? {} : { heading }),
  facts,
});

/**
 * What a command ends on. Every field is read-only: a summary is a value the
 * command returned and the chain is about to draw, so a later step that wants
 * a different ending builds a different summary (`{ ...summary, next }`)
 * rather than reaching into one that has already been handed over.
 */
export type Summary = {
  /**
   * The one line that closes the chain: what happened, as a sentence, with no
   * full stop. It is a single line; anything longer belongs in {@link lines}.
   * Where it ran is {@link ran}, not part of this.
   */
  readonly title: string;
  /** Facts worth stating, such as the project and the file that was written. */
  readonly sections: readonly Section[];
  /** Anything the command renders itself, such as a table, under the facts. */
  readonly lines?: readonly string[];
  /** What the command adds after its rendering, such as `Resolved now: …`. */
  readonly extras?: readonly string[];
  /** What to do next, each step a sentence and the commands it asks for. */
  readonly next?: readonly BoxAction[];
  /** The headline is a failure, so it closes the chain in red. */
  readonly failed?: boolean;
  /** Draw the box even with no steps, for a command whose body is instructions. */
  readonly boxed?: boolean;
  /** The box's own title. Defaults to "Summary". */
  readonly boxTitle?: string;
  /**
   * Where the command ran, as the box's last line: the project and the server
   * it spoke to. Every command that reaches a server states it, in one place,
   * rather than printing it before the first question.
   */
  readonly ran?: string;
};

/**
 * What a command's work returns: the payload of the `--json` envelope, and what
 * a person sees. Both are required, so a command cannot produce one without the
 * other.
 */
export type Outcome<D> = { readonly data: D; readonly summary: Summary };

export const outcome = <D>(data: D, summary: Summary): Outcome<D> => ({ data, summary });
