import type { Parsed } from "@zitadel/config/idp";

import { confirmationHint, ZitadelError } from "@/lib/errors";
import { Stdin } from "@/lib/stdin";
import {
  type AnyQuestion,
  type Confirmer,
  type ConfirmQuestion,
  DrawnPrompter,
  type Kind,
  type MultiselectQuestion,
  type Optional,
  type Prompter,
  type Prompting,
  type Questions,
  type SecretQuestion,
  type SelectQuestion,
  type TextQuestion,
  type YesNoQuestion,
} from "@/lib/ui";

/** What the session says about who can answer, beyond the question itself. */
export type Session = Prompting & {
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** The command's `--force`: it answers a `confirm` without asking. */
  force: boolean;
  /** The stream piped input is read from. Defaults to the process's stdin. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
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
 * 3. **A prompt**, only when the session is `interactive`. Which prompt is
 *    the command's presentation, not the question's: a wizard's is drawn in
 *    its chain, with the guide beside it, and a normal command's is the same
 *    prompt without.
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
 * - `yesNo` returns a boolean. With no one to ask it throws "No <name>
 *   supplied"; `force` never answers it.
 * - `confirm` returns a boolean. The session's `force` (the command's
 *   `--force`) answers it yes without asking. With no one to ask and no
 *   `force`, it throws an `E_CONFIRMATION_REQUIRED` error carrying the
 *   question in `details.question`, for an agent to put to a person.
 *   Only `Consent.request` asks it.
 *
 * Cancelling a prompt (Ctrl-C) aborts the run's signal and throws an
 * `AbortError` instead of returning a sentinel, so a command never carries on
 * with a missing answer, and the run ends as `E_CANCELLED`, exiting 130 like
 * Ctrl-C anywhere else. A drawn prompt closes its chain with
 * "Cancelled", which is all a person is shown: a cancel is their own
 * decision, not an error. A plain one has no chain to close, so the run says
 * "Cancelled" on a line of its own once the prompt is erased.
 *
 * Each method is the engine with its kind already chosen, which is the only
 * cast in the class: the engine cannot see the question's type, so it returns
 * `unknown` and the kind-to-type mapping the overloads promise is trusted at
 * the method.
 *
 * @example
 * const clientId = await Asker.for(session).text({
 *   name: "client id",
 *   message: "What is the client ID of your Google OAuth app?",
 *   flag: "--client-id",
 *   parse: parseClientId,
 *   given: flags["client-id"],
 * });
 */
export class Asker implements Questions, Confirmer {
  private readonly session: Session;
  private readonly prompt: Prompter;

  private constructor(session: Session, prompt: Prompter) {
    this.session = session;
    this.prompt = prompt;
  }

  /**
   * The questions as a session asks them. Commands get one from `this.ask`,
   * which the UI builds from the run's audience and its presentation; it takes
   * the session as an argument so it can be tested without a terminal.
   *
   * @param session - Who can answer, and how a prompt is drawn.
   * @returns The questions, bound to the session.
   */
  static for(session: Session): Asker {
    return new Asker(session, new DrawnPrompter(session.guide ?? true));
  }

  /** Free text. With `optional`, `undefined` when nothing was given. */
  text<T>(question: TextQuestion<T> & Optional): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  text<T>(question: TextQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return this.ask("text", question) as Promise<T | undefined>;
  }

  /** Masked text, never a flag, never echoed. */
  secret<T>(question: SecretQuestion<T> & Optional): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  secret<T>(question: SecretQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return this.ask("secret", question) as Promise<T | undefined>;
  }

  /**
   * One of several options.
   *
   * @param question - What is asked, with its options.
   * @returns The chosen option's value.
   */
  select<V>(question: SelectQuestion<V>): Promise<V> {
    return this.ask("select", question) as Promise<V>;
  }

  /**
   * Any number of several options.
   *
   * @param question - What is asked, with its options.
   * @returns The chosen options' values.
   */
  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]> {
    return this.ask("multiselect", question) as Promise<V[]>;
  }

  /**
   * Yes or no, about nothing destructive. `--force` never answers it.
   *
   * @param question - What is asked.
   * @returns Whether the answer is yes.
   */
  yesNo(question: YesNoQuestion): Promise<boolean> {
    return this.ask("yes-no", question) as Promise<boolean>;
  }

  /**
   * Agreement to a destructive action, which the session's `force` gives
   * without asking.
   *
   * @param question - What is asked.
   * @returns Whether the action may go ahead.
   */
  confirm(question: ConfirmQuestion): Promise<boolean> {
    return this.ask("confirm", question) as Promise<boolean>;
  }

  /**
   * The engine: finds the answer in the order of sources the class documents.
   *
   * @param kind - Which question this is.
   * @param q - The question.
   * @returns The answer, whose type the calling method promises.
   * @throws {ZitadelError} `E_VALIDATION` when there is no answer, or one that
   *   does not parse; `E_CONFIRMATION_REQUIRED` for a `confirm` with no one to ask.
   */
  private async ask(kind: Kind, q: AnyQuestion): Promise<unknown> {
    const stdin = this.session.stdin ?? process.stdin;

    if (kind === "confirm") {
      if (this.session.force) {
        return true;
      }
      if (!this.session.interactive) {
        throw new ZitadelError(
          "E_CONFIRMATION_REQUIRED",
          `Cannot ${q.name} without --force in non-interactive mode`,
          {
            hint: confirmationHint(q.message),
            ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
            details: { question: q.message },
          },
        );
      }
      return this.drawn(() => {
        return this.prompt.confirm(q);
      });
    }

    if (kind === "yes-no") {
      if (!this.session.interactive) {
        throw this.unsupplied(kind, q);
      }
      return this.drawn(() => {
        return this.prompt.confirm(q);
      });
    }

    if (kind === "select" || kind === "multiselect") {
      if (!this.session.interactive) {
        throw this.unsupplied(kind, q);
      }
      return this.drawn(() => {
        return kind === "select" ? this.prompt.select(q) : this.prompt.multiselect(q);
      });
    }

    const parse =
      q.parse ??
      ((raw: string): Parsed<unknown> => {
        return {
          ok: true,
          value: raw,
        };
      });
    const accept = (raw: string): unknown => {
      const parsed = parse(raw);
      if (!parsed.ok) {
        throw this.refusal(q, parsed.problem);
      }
      return parsed.value;
    };
    if (q.given !== undefined) {
      return accept(q.given);
    }
    if (q.stdin === true && !stdin.isTTY) {
      const piped = await Stdin.on(stdin).read();
      const parsed = parse(piped);
      if (parsed.ok) {
        return parsed.value;
      }
      if (piped.trim() !== "") {
        throw this.refusal(q, parsed.problem);
      }
    }
    if (q.optional === true) {
      return undefined;
    }
    if (!this.session.interactive) {
      throw this.unsupplied(kind, q);
    }
    const validate = (value: string | undefined): string | undefined => {
      const parsed = parse(value ?? "");
      return parsed.ok ? undefined : parsed.problem;
    };
    const typed = await this.drawn(() => {
      return kind === "secret" ? this.prompt.secret(q, validate) : this.prompt.text(q, validate);
    });
    return accept(typed);
  }

  /**
   * A refusal that points at the question's own retry.
   *
   * @param q - The question that went unanswered.
   * @param message - What went wrong.
   * @param hint - What to do about it.
   * @returns The `E_VALIDATION` error to throw.
   */
  private refusal(q: AnyQuestion, message: string, hint?: string): ZitadelError {
    return new ZitadelError("E_VALIDATION", message, {
      ...(hint === undefined ? {} : { hint }),
      ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
    });
  }

  /**
   * The refusal for a question nobody answered and nobody can be asked: "No
   * <name> supplied", with every way a script could have supplied it.
   *
   * @param kind - Which question this is.
   * @param q - The question that went unanswered.
   * @returns The `E_VALIDATION` error to throw.
   */
  private unsupplied(kind: Kind, q: AnyQuestion): ZitadelError {
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
        : [
            `${ways.join(", or ").replace(/^./, (c) => {
              return c.toUpperCase();
            })}.`,
          ]),
      ...(secret
        ? ["It is never a flag: that would put it in shell history, a process listing and CI logs."]
        : []),
      ...(isText && q.retry !== undefined ? [`For example: ${q.retry}`] : []),
    ].join(" ");
    return this.refusal(q, `No ${q.name} supplied`, hint === "" ? undefined : hint);
  }

  /**
   * Draws a prompt inside the session's hook. The hook sees the prompt throw
   * too, so a spinner paused for the prompt is never left paused.
   *
   * @param draw - Draws the prompt.
   * @returns What the prompt resolved to.
   */
  private async drawn<T>(draw: () => Promise<T>): Promise<T> {
    if (this.session.around === undefined) {
      return draw();
    }
    return this.session.around(draw);
  }
}
