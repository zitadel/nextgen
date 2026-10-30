import type { Parsed } from "@zitadel/config/idp";

import type { SuggestedCommand } from "../suggestion";

/**
 * The questions a command may ask, as types. {@link Questions} has one method
 * per kind of question rather than a kind written out as a string, so a
 * command cannot ask for a select and read back a boolean, and so the answer's
 * type follows from the question's `parse` without a cast at the call site.
 *
 * Every question is worded as a polite question to a person (`apps/cli/AGENTS.md`),
 * and the same question is asked the same way by every command that asks it.
 */

/**
 * One option of a `select` or a `multiselect`. A `disabled` one is shown, with
 * its hint always visible, but cannot be chosen: for a choice that exists but
 * is not available yet, such as a local server that is not running.
 */
export type Choice<V> = {
  readonly value: V;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
};

/** What every question says about itself, whatever it asks for. */
type Question = {
  /**
   * What is being asked for, as a lowercase noun phrase ("client id"). A run
   * with nobody to ask refuses by this name ("No client id supplied"), so it
   * is required even for a question only ever asked in a terminal.
   */
  name: string;
  /** The question as the prompt shows it, worded as a question. */
  message: string;
  /**
   * The flag that carries this value (`--client-id`), when there is one. The
   * refusal tells a scripted caller to pass it. Never set for a secret.
   */
  flag?: string;
  /**
   * The command to run again with the missing input, written for an agent. It
   * becomes the refusal's `nextCommands`, and is quoted in its hint.
   */
  retry?: SuggestedCommand;
};

/**
 * A question whose answer is text. `parse` runs on the answer from every
 * source — a flag, a pipe, a typed answer — so one rule decides what is valid
 * and the caller never parses again; in the prompt it refuses an answer as it
 * is typed.
 */
export type TextQuestion<T> = Question & {
  parse: (raw: string) => Parsed<T>;
  /** The value the command line already carried. */
  given?: string;
  /** Whether piped stdin may answer, for a value a script supplies. */
  stdin?: boolean;
  initialValue?: string;
  placeholder?: string;
};

/**
 * Whether having no answer is acceptable, for a value a rerun may replace but
 * does not need. Such a question never prompts and never refuses for want of a
 * value: it answers `undefined` when nothing was given and nothing, or only an
 * empty pipe, was piped in. A pipe carrying content that does not parse is
 * still an `E_VALIDATION` error, like any other source.
 *
 * It is spelled `optional: true` rather than `optional?: boolean` so the
 * asker's overloads can tell the two apart and the answer's type follows the
 * question: a question that may answer `undefined` says so at the call site.
 */
export type Optional = { optional: true };

/**
 * The same, masked. A secret is never a flag and never `given`: that would put
 * it in shell history, a process listing and CI logs.
 */
export type SecretQuestion<T> = Omit<TextQuestion<T>, "flag" | "given">;

export type SelectQuestion<V> = Question & { options: Choice<V>[]; initialValue?: V };

export type MultiselectQuestion<V> = Question & { options: Choice<V>[]; required?: boolean };

export type ConfirmQuestion = Question & { initialValue?: boolean };

/**
 * The one way the CLI takes input from a person or a script: one method per
 * kind of question, so a command cannot ask for a select and read back a
 * boolean, and the answer's type follows from the question's own `parse`.
 *
 * A command reaches it as `this.ask` (`Promptable`), which binds it to the
 * run's audience; `setup`'s prompts take it as `ctx.ask`. The sources are
 * tried in a fixed order, and the first that applies answers — a flag, piped
 * stdin, a prompt, and otherwise a refusal naming what was missing. See
 * `lib/input.ts` for the whole rule.
 */
export interface Questions {
  /** Free text. With `optional`, `undefined` when nothing was given. */
  text<T>(question: TextQuestion<T> & Optional): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  /** Masked text, never a flag, never echoed. */
  secret<T>(question: SecretQuestion<T> & Optional): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  select<V>(question: SelectQuestion<V>): Promise<V>;
  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]>;
  /** Yes or no. The command's `--force` answers it yes without asking. */
  confirm(question: ConfirmQuestion): Promise<boolean>;
}
