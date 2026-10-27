import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";

import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError } from "./errors";
import { readStdin } from "./variables";
import type { SuggestedCommand } from "./suggestion";

/**
 * One option of a `select` or `multiselect`. A `disabled` one is shown, with
 * its hint always visible, but cannot be chosen: for a choice that exists but
 * is not available yet, such as a server that is not running.
 */
type Choice<V> = { value: V; label: string; hint?: string; disabled?: boolean };

/** What every question says about itself, whatever it asks for. */
type Common = {
  /**
   * What is being asked for, as a lowercase noun phrase ("client id"). It is
   * required because any question can meet a run with nobody to ask, and the
   * refusal names it: "No client id supplied". For a `confirm` it is the
   * action instead ("delete the variable"), which completes "Cannot delete the
   * variable without --force". A question that is only ever asked in a
   * terminal never shows it.
   */
  name: string;
  /** The question as the prompt shows it. */
  message: string;
  /**
   * The flag that carries this value (`--client-id`), when there is one. The
   * refusal tells a scripted caller to pass it. Leave it out for a question a
   * script cannot answer with a flag. It is ignored for a `secret`, which is
   * never a flag.
   */
  flag?: string;
  /**
   * The command to run again with the missing input, written for an agent to
   * run. It becomes the refusal's `nextCommands`, and for a value it is also
   * quoted in the hint as an example.
   */
  retry?: SuggestedCommand;
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
   * Whether having no answer is acceptable, for a value a rerun may replace
   * but does not need. The question then never prompts and never refuses for
   * want of a value: it returns `undefined` when nothing was given and
   * nothing, or only an empty pipe, was piped in. A pipe that has content that
   * does not parse is still an `E_VALIDATION` error, like any other source.
   */
  optional?: boolean;
  initialValue?: string;
  placeholder?: string;
};

type SelectQuestion = Common & {
  kind: "select";
  options: Choice<unknown>[];
  initialValue?: unknown;
};

type MultiselectQuestion = Common & {
  kind: "multiselect";
  options: Choice<unknown>[];
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
 *    would block forever, so it is never read. An empty pipe that does not
 *    parse is a script that piped nothing, and counts as no pipe.
 * 3. **A prompt**, only when the session is `interactive`.
 * 4. **Otherwise an `E_VALIDATION` error**: "No <name> supplied", with a hint
 *    built from the question's `flag`, whether stdin is accepted and, as an
 *    example, its `retry`; and `retry` as `nextCommands` for an agent to run.
 *
 * What comes back follows the `kind`:
 *
 * - `text` and `secret` return what `parse` produced. `parse` runs on the
 *   value from every source, so a flag, a pipe and a typed answer are held to
 *   one rule, and the caller never parses again. In the prompt it is the
 *   validator that refuses an answer as it is typed. A value from a flag or a
 *   pipe that does not parse is an `E_VALIDATION` error saying why. `secret`
 *   masks what is typed, is never a flag, and is never echoed or put in an
 *   error. With `optional`, the answer may be `undefined` (see its docs).
 * - `select` returns the chosen option's `value`.
 * - `multiselect` returns the chosen options' `value`s.
 * - `confirm` returns a boolean. The session's `force` (the command's
 *   `--force`) answers it yes without asking. With no one to ask and no
 *   `force`, it throws an `E_VALIDATION` error saying `--force` is required.
 *   A command whose `--force` means something else must not hand out a
 *   session with `force` set.
 *
 * Cancelling a prompt (Ctrl-C) throws `E_CANCELLED` instead of returning a
 * sentinel, so a command never carries on with a missing answer, and exits
 * 130 like Ctrl-C anywhere else. The prompt closes with "Cancelled.", which is
 * all a person is shown: a cancel is their own decision, not an error.
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
  const refusal = (message: string, hint?: string): ZitadelError =>
    new ZitadelError("E_VALIDATION", message, {
      ...(hint === undefined ? {} : { hint }),
      ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
    });
  const cancelled = (): ZitadelError => {
    cancel("Cancelled.");
    return new ZitadelError("E_CANCELLED", "Cancelled by user");
  };
  const unsupplied = (): ZitadelError => {
    const isText = q.kind === "text" || q.kind === "secret";
    // A secret is never a flag, whatever the question says, because that would
    // put it in shell history, a process listing and CI logs.
    const secret = q.kind === "secret";
    const ways = [
      ...(q.flag === undefined || secret ? [] : [`pass ${q.flag}`]),
      ...(isText && q.stdin === true ? ["pipe it in on stdin"] : []),
    ];
    const hint = [
      ...(ways.length === 0
        ? []
        : [`${ways.join(", or ").replace(/^./, (c) => c.toUpperCase())}.`]),
      ...(secret
        ? ["It is never a flag: that would put it in shell history, a process listing and CI logs."]
        : []),
      ...(isText && q.retry !== undefined ? [`For example: ${q.retry}`] : []),
    ].join(" ");
    return refusal(`No ${q.name} supplied`, hint === "" ? undefined : hint);
  };

  const answer = async (): Promise<unknown> => {
    if (q.kind === "confirm") {
      if (session.force) {
        return true;
      }
      if (!session.interactive) {
        throw refusal(
          `Cannot ${q.name} without --force in non-interactive mode`,
          `Pass --force to ${q.name}.`,
        );
      }
      const confirmed = await confirm({
        message: q.message,
        initialValue: q.initialValue ?? false,
      });
      if (isCancel(confirmed)) {
        throw cancelled();
      }
      return confirmed;
    }

    if (q.kind === "select" || q.kind === "multiselect") {
      if (!session.interactive) {
        throw unsupplied();
      }
      const chosen =
        q.kind === "select"
          ? await select({
              message: q.message,
              options: q.options,
              initialValue: q.initialValue,
            })
          : await multiselect({
              message: q.message,
              options: q.options,
              required: q.required,
            });
      if (isCancel(chosen)) {
        throw cancelled();
      }
      return chosen;
    }

    const accept = (raw: string): unknown => {
      const parsed = q.parse(raw);
      if (!parsed.ok) {
        throw refusal(parsed.problem);
      }
      return parsed.value;
    };
    if (q.given !== undefined) {
      return accept(q.given);
    }
    if (q.stdin === true && !stdin.isTTY) {
      const piped = await readStdin(stdin);
      const parsed = q.parse(piped);
      if (parsed.ok) {
        return parsed.value;
      }
      if (piped.trim() !== "") {
        throw refusal(parsed.problem);
      }
    }
    if (q.optional === true) {
      return undefined;
    }
    if (!session.interactive) {
      throw unsupplied();
    }
    const validate = (value: string | undefined): string | undefined => {
      const parsed = q.parse(value ?? "");
      return parsed.ok ? undefined : parsed.problem;
    };
    const typed =
      q.kind === "secret"
        ? await password({ message: q.message, validate })
        : await text({
            message: q.message,
            validate,
            initialValue: q.initialValue,
            placeholder: q.placeholder,
          });
    if (isCancel(typed)) {
      throw cancelled();
    }
    return accept(String(typed ?? ""));
  };

  // The one cast: `Answer<Q>` is computed from the question's type, which the
  // branches above cannot see, so each branch returns `unknown` and this is
  // where the kind-to-type mapping the question's type promises is trusted.
  return (await answer()) as Answer<Q>;
}
