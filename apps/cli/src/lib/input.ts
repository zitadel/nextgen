import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";

import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError } from "./errors";
import type {
  Choice,
  ConfirmQuestion,
  MultiselectQuestion,
  Optional,
  Questions,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./ui/questions";
import type { SuggestedCommand } from "./suggestion";
import { readStdin } from "./variables";

/**
 * Which of the five questions is being asked. It is an argument of the engine
 * below and never a field of a question: a command picks the kind by calling
 * {@link Questions.text} or one of its siblings, so there is no string to get
 * wrong and no answer type to cast.
 */
type Kind = "text" | "secret" | "select" | "multiselect" | "confirm";

/**
 * Every field any of the five questions can carry, which is what the engine
 * reads. The types in `ui/questions.ts` are the ones a command writes, and
 * each of them is assignable to this.
 */
type AnyQuestion = {
  name: string;
  message: string;
  flag?: string;
  retry?: SuggestedCommand;
  parse?: (raw: string) => Parsed<unknown>;
  given?: string;
  stdin?: boolean;
  optional?: boolean;
  initialValue?: unknown;
  placeholder?: string;
  options?: Choice<unknown>[];
  required?: boolean;
};

/** What the session says about who can answer, beyond the question itself. */
export type Session = {
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** The command's `--force`: it answers a `confirm` without asking. */
  force: boolean;
  /** The stream piped input is read from. Defaults to the process's stdin. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Called just before a prompt is drawn, so the caller can open the chain it belongs to. */
  before?: () => void;
  /** Called when a prompt has been answered, so the caller can space what follows it. */
  after?: () => void;
};

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
 * What comes back follows the method that was called:
 *
 * - `text` and `secret` return what `parse` produced. `parse` runs on the
 *   value from every source, so a flag, a pipe and a typed answer are held to
 *   one rule, and the caller never parses again. In the prompt it is the
 *   validator that refuses an answer as it is typed. A value from a flag or a
 *   pipe that does not parse is an `E_VALIDATION` error saying why. `secret`
 *   masks what is typed, is never a flag, and is never echoed or put in an
 *   error. With `optional`, the answer may be `undefined`.
 * - `select` returns the chosen option's `value`.
 * - `multiselect` returns the chosen options' `value`s.
 * - `confirm` returns a boolean. The session's `force` (the command's
 *   `--force`) answers it yes without asking. With no one to ask and no
 *   `force`, it throws an `E_VALIDATION` error saying `--force` is required.
 *   A command whose `--force` means something else asks through a session
 *   with `force` unset (`Ui.questions({ honorForce: false })`).
 *
 * Cancelling a prompt (Ctrl-C) throws `E_CANCELLED` instead of returning a
 * sentinel, so a command never carries on with a missing answer, and exits
 * 130 like Ctrl-C anywhere else. The prompt closes with "Cancelled.", which is
 * all a person is shown: a cancel is their own decision, not an error.
 */
async function askOne(kind: Kind, q: AnyQuestion, session: Session): Promise<unknown> {
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
    const isText = kind === "text" || kind === "secret";
    // A secret is never a flag, whatever the question says, because that would
    // put it in shell history, a process listing and CI logs.
    const secret = kind === "secret";
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

  if (kind === "confirm") {
    if (session.force) {
      return true;
    }
    if (!session.interactive) {
      throw refusal(
        `Cannot ${q.name} without --force in non-interactive mode`,
        `Pass --force to ${q.name}.`,
      );
    }
    session.before?.();
    const confirmed = await confirm({
      message: q.message,
      initialValue: (q.initialValue as boolean | undefined) ?? false,
    });
    session.after?.();
    if (isCancel(confirmed)) {
      throw cancelled();
    }
    return confirmed;
  }

  if (kind === "select" || kind === "multiselect") {
    if (!session.interactive) {
      throw unsupplied();
    }
    session.before?.();
    const options = q.options ?? [];
    const chosen =
      kind === "select"
        ? await select({ message: q.message, options, initialValue: q.initialValue })
        : await multiselect({ message: q.message, options, required: q.required });
    session.after?.();
    if (isCancel(chosen)) {
      throw cancelled();
    }
    return chosen;
  }

  // Only `text` and `secret` are left, and both carry a parser.
  const parse = q.parse ?? ((raw: string): Parsed<unknown> => ({ ok: true, value: raw }));
  const accept = (raw: string): unknown => {
    const parsed = parse(raw);
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
    const parsed = parse(piped);
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
    const parsed = parse(value ?? "");
    return parsed.ok ? undefined : parsed.problem;
  };
  session.before?.();
  const typed =
    kind === "secret"
      ? await password({ message: q.message, validate })
      : await text({
          message: q.message,
          validate,
          initialValue: q.initialValue as string | undefined,
          placeholder: q.placeholder,
        });
  session.after?.();
  if (isCancel(typed)) {
    throw cancelled();
  }
  return accept(String(typed ?? ""));
}

/**
 * {@link Questions} bound to one session. Each method is the engine above with
 * its kind already chosen, which is the only cast in the module: the branches
 * of {@link askOne} cannot see the question's type, so each returns `unknown`
 * and the kind-to-type mapping the overloads promise is trusted here.
 */
class SessionQuestions implements Questions {
  private readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  text<T>(question: TextQuestion<T> & Optional): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  text<T>(question: TextQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return askOne("text", question, this.session) as Promise<T | undefined>;
  }

  secret<T>(question: SecretQuestion<T> & Optional): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  secret<T>(question: SecretQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return askOne("secret", question, this.session) as Promise<T | undefined>;
  }

  select<V>(question: SelectQuestion<V>): Promise<V> {
    return askOne("select", question, this.session) as Promise<V>;
  }

  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]> {
    return askOne("multiselect", question, this.session) as Promise<V[]>;
  }

  confirm(question: ConfirmQuestion): Promise<boolean> {
    return askOne("confirm", question, this.session) as Promise<boolean>;
  }
}

/**
 * The five questions, bound to who can answer them. Commands get one from
 * `this.ask`, which the UI package builds from the run's audience; it takes
 * the session as an argument so it can be tested without a terminal.
 *
 * @example
 * const clientId = await this.ask.text({
 *   name: "client id",
 *   message: "What is the client ID of your Google OAuth app?",
 *   flag: "--client-id",
 *   parse: parseClientId,
 *   given: flags["client-id"],
 * });
 */
export function asker(session: Session): Questions {
  return new SessionQuestions(session);
}
