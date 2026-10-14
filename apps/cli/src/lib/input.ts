import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";

import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError } from "./errors";
import { readStdin } from "./variables";

/** One option of a `select` or `multiselect`. */
type Choice<V> = { value: V; label: string; hint?: string };

/** What every question says about itself, whatever it asks for. */
type Common = {
  /**
   * What is being asked for, as a lowercase noun phrase ("client id"). It
   * completes the error a run with no way to answer gets: "No client id
   * supplied". For a `confirm` it is the action instead ("delete the
   * variable"), which completes "Cannot delete the variable without --force".
   */
  name: string;
  /** The question as the prompt shows it. */
  message: string;
  /**
   * The flag that carries this value (`--client-id`), when there is one. It
   * is what the error tells a scripted caller to pass. A value that is never a
   * flag, such as a secret, leaves it out.
   */
  flag?: string;
  /**
   * The command to run again with the missing input, for an agent to run. It
   * becomes the error's `nextCommands`.
   */
  retry?: string;
};

/** A question whose answer is text that must parse. */
type TextQuestion = Common & {
  kind: "text" | "secret";
  /**
   * Turns the text into the value that is returned, or says what is wrong
   * with it. It runs on the value from every source, and in the prompt it is
   * what refuses an answer as it is typed. Use the parser the flag for this
   * value uses and the flag and the prompt cannot disagree.
   */
  parse: (value: string) => Parsed<unknown>;
  /** The value from a flag, if the command line gave one. */
  given?: string;
  /** Whether piped stdin may answer, for a value a script supplies. */
  stdin?: boolean;
  /**
   * Whether having no answer is acceptable. The question then never prompts
   * and never throws: it returns `undefined` when nothing was given or piped
   * in, which is for a value a rerun may replace but does not need.
   */
  optional?: boolean;
  initialValue?: string;
  placeholder?: string;
};

type SelectQuestion = Common & {
  kind: "select";
  options: Choice<unknown>[];
  given?: unknown;
  initialValue?: unknown;
};

type MultiselectQuestion = Common & {
  kind: "multiselect";
  options: Choice<unknown>[];
  given?: unknown[];
  initialValues?: unknown[];
  /** Whether at least one option must be ticked. */
  required?: boolean;
};

type ConfirmQuestion = Common & {
  kind: "confirm";
  initialValue?: boolean;
};

type Question = TextQuestion | SelectQuestion | MultiselectQuestion | ConfirmQuestion;

/** What `input` returns for a question: it follows the question's kind. */
type Answer<Q extends Question> = Q extends { kind: "confirm" }
  ? boolean
  : Q extends { kind: "multiselect"; options: Choice<infer V>[] }
    ? V[]
    : Q extends { kind: "select"; options: Choice<infer V>[] }
      ? V
      : Q extends { optional: true; parse: (value: string) => Parsed<infer T> }
        ? T | undefined
        : Q extends { parse: (value: string) => Parsed<infer T> }
          ? T
          : never;

/** What the session says about who can answer, beyond the question itself. */
type Session = {
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** The command's `--force`: it answers a `confirm` without asking. */
  force: boolean;
  /** The stream piped input is read from. Defaults to the process's stdin. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
};

/**
 * `input` with the session already filled in, which is what a command's
 * `this.input` and the setup wizard's prompt context hand out.
 */
export type Asker = <Q extends Question>(question: Q) => Promise<Answer<Q>>;

/**
 * The one way the CLI takes input from a person or a script. Every command
 * that needs a value, a choice or a confirmation goes through here, so they
 * all look, feel and fail the same way. It is the only module that imports
 * clack's input prompts, and a test fails if any other file does.
 *
 * The sources are tried in a fixed order, and the first that applies answers:
 *
 * 1. **`given`**, the value the command line already carried (a flag).
 * 2. **Piped stdin**, only when the question sets `stdin` and stdin is not a
 *    terminal. A terminal on stdin means nothing was piped, and reading it
 *    would block forever, so it is never read.
 * 3. **A prompt**, only when the session is `interactive`.
 * 4. **Otherwise an `E_VALIDATION` error**: "No <name> supplied", with a hint
 *    built from the question's `flag` and whether stdin is accepted, and the
 *    question's `retry` command as `nextCommands`.
 *
 * What comes back follows the `kind`:
 *
 * - `text` and `secret` return what `parse` produced. `parse` runs on the
 *   value from every source, so a flag, a pipe and a typed answer are held to
 *   one rule, and the caller never parses again. In the prompt it is the
 *   validator that refuses an answer as it is typed. A value from a flag or a
 *   pipe that does not parse is an `E_VALIDATION` error saying why. `secret`
 *   masks what is typed; the value is never echoed or put in an error.
 * - `select` returns the chosen option's `value`.
 * - `multiselect` returns the chosen options' `value`s.
 * - `confirm` returns a boolean. `force` answers it as yes, so the command's
 *   `--force` skips the question. With no one to ask and no `force`, it throws
 *   an `E_VALIDATION` error saying `--force` is required.
 *
 * Cancelling a prompt (Ctrl-C) throws `E_VALIDATION` "Cancelled by user"
 * instead of returning a sentinel, so a command never carries on with a
 * missing answer.
 *
 * Commands call this through `this.input(...)` on `BaseCommand`, which fills in
 * `session` from the command's own flags. It takes the session as an argument
 * so it can be tested without a terminal.
 *
 * @example
 * const clientId = await this.input({
 *   kind: "text",
 *   name: "client id",
 *   message: "Client ID",
 *   flag: "--client-id",
 *   parse: parseClientId,
 *   given: flags["client-id"],
 * });
 */
export async function input<Q extends Question>(question: Q, session: Session): Promise<Answer<Q>> {
  const q: Question = question;
  const stdin = session.stdin ?? process.stdin;
  const fail = (message: string, hint?: string): ZitadelError =>
    new ZitadelError("E_VALIDATION", message, {
      ...(hint === undefined ? {} : { hint }),
      ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
    });
  const cancelled = (): ZitadelError => {
    cancel("Cancelled.");
    return new ZitadelError("E_VALIDATION", "Cancelled by user");
  };
  const unsupplied = (acceptsStdin: boolean): ZitadelError => {
    const ways = [
      ...(q.flag === undefined ? [] : [`pass ${q.flag}`]),
      ...(acceptsStdin ? ["pipe it in on stdin"] : []),
    ];
    const secret =
      q.kind === "secret" && q.flag === undefined
        ? " It is never a flag: that would put it in shell history, a process listing and CI logs."
        : "";
    const hint =
      ways.length === 0
        ? undefined
        : `${ways.join(", or ").replace(/^./, (first) => first.toUpperCase())}.${secret}`;
    return fail(`No ${q.name} supplied`, hint);
  };

  if (q.kind === "confirm") {
    if (session.force) {
      return true as Answer<Q>;
    }
    if (!session.interactive) {
      throw fail(
        `Cannot ${q.name} without --force in non-interactive mode`,
        `Pass --force to ${q.name}.`,
      );
    }
    const answer = await confirm({ message: q.message, initialValue: q.initialValue ?? false });
    if (isCancel(answer)) {
      throw cancelled();
    }
    return answer as Answer<Q>;
  }

  if (q.kind === "select" || q.kind === "multiselect") {
    if (q.given !== undefined) {
      return q.given as Answer<Q>;
    }
    if (!session.interactive) {
      throw unsupplied(false);
    }
    const answer =
      q.kind === "select"
        ? await select(q as unknown as Parameters<typeof select>[0])
        : await multiselect(q as unknown as Parameters<typeof multiselect>[0]);
    if (isCancel(answer)) {
      throw cancelled();
    }
    return answer as Answer<Q>;
  }

  const accept = (raw: string): unknown => {
    const parsed = q.parse(raw);
    if (!parsed.ok) {
      throw fail(parsed.problem);
    }
    return parsed.value;
  };
  if (q.given !== undefined) {
    return accept(q.given) as Answer<Q>;
  }
  if (q.stdin === true && !stdin.isTTY) {
    // An empty pipe that does not parse is a script that piped nothing, which
    // is the same as no pipe: it falls through to the prompt or the error.
    const piped = await readStdin(stdin);
    const parsed = q.parse(piped);
    if (parsed.ok) {
      return parsed.value as Answer<Q>;
    }
    if (piped.trim() !== "") {
      throw fail(parsed.problem);
    }
  }
  if (q.optional === true) {
    return undefined as Answer<Q>;
  }
  if (!session.interactive) {
    throw unsupplied(q.stdin === true);
  }
  const validate = (value: string | undefined): string | undefined => {
    const parsed = q.parse(value ?? "");
    return parsed.ok ? undefined : parsed.problem;
  };
  const answer =
    q.kind === "secret"
      ? await password({ message: q.message, validate })
      : await text({
          message: q.message,
          validate,
          initialValue: q.initialValue,
          placeholder: q.placeholder,
        });
  if (isCancel(answer)) {
    throw cancelled();
  }
  return accept(String(answer ?? "")) as Answer<Q>;
}
