import type { Parsed } from "@zitadel/config/idp";

import type { SuggestedCommand } from "../suggestion";

/**
 * The questions a command may ask, as types. There is one method per kind of
 * question rather than a `kind: "text"` string, so a command cannot ask for a
 * select and read back a boolean, and so the answer's type follows from the
 * question's `parse` without a cast at the call site.
 *
 * Every question is worded as a polite question to a person (`apps/cli/AGENTS.md`),
 * and the same question is asked the same way by every command that asks it.
 */

/** One option of a `select` or a `multiselect`. */
export type Choice<V> = { value: V; label: string; hint?: string };

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
 * The same, masked. A secret is never a flag and never `given`: that would put
 * it in shell history, a process listing and CI logs.
 */
export type SecretQuestion<T> = Omit<TextQuestion<T>, "flag" | "given">;

export type SelectQuestion<V> = Question & { options: Choice<V>[]; initialValue?: V };

export type MultiselectQuestion<V> = Question & { options: Choice<V>[]; required?: boolean };

export type ConfirmQuestion = Question & { initialValue?: boolean };
