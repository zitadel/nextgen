import type { Writable } from "node:stream";
import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";
import type { Parsed } from "@zitadel/config/idp";

import { CANCELLED, confirmationHint, PromptCancelled, ZitadelError } from "./errors";
import { flatOutput } from "./flat-output";
import type { SuggestedCommand } from "./suggestion";
import { escapeControlCharacters } from "./terminal-text";
import type {
  Choice,
  Confirmer,
  ConfirmQuestion,
  MultiselectQuestion,
  Optional,
  Questions,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
  YesNoQuestion,
} from "./ui/questions";
import { readStdin } from "./variables";

/**
 * Which of the six questions is being asked. It is an argument of the engine
 * below and never a field of a question: a command picks the kind by calling
 * {@link Questions.text} or one of its siblings, so there is no string to get
 * wrong and no answer type to cast.
 */
type Kind = "text" | "secret" | "select" | "multiselect" | "yes-no" | "confirm";

/**
 * Every field any of the six questions can carry, which is what the engine
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
  /**
   * Whether a prompt is drawn with clack's guide, the gray `│` down its left
   * side. A wizard's questions sit inside its chain and carry it; a normal
   * command's are the same prompts with nothing beside them.
   */
  guide?: boolean;
  /**
   * Draws a prompt between the caller's own steps: what it does before `draw`
   * opens the chain the prompt belongs to, and what it does once `draw`
   * settles, answered or not, spaces what follows it.
   *
   * @typeParam T - What the prompt resolves to.
   */
  around?: <T>(draw: () => Promise<T>) => Promise<T>;
};

/**
 * A question as a terminal draws it. The question is kept as it came wherever a
 * script reads it (the refusal's hint and `details.question`), so what it names
 * from the server is spelled out here, where it reaches a screen.
 */
function spelled(question: AnyQuestion): string {
  return escapeControlCharacters(question.message);
}

/** How a typed answer is refused as it is typed: the problem, or nothing. */
type Validate = (value: string | undefined) => string | undefined;

/**
 * What actually asks a person, once the flag, the pipe and `--force` have all
 * been ruled out. There are two, because there are two presentations: a
 * wizard's questions are drawn inside its chain, and a normal command's are
 * one undecorated line with the answer typed on it. A command picks neither —
 * it asks `this.ask`, and its presentation decides which of these answers.
 *
 * Every method either answers or throws `E_CANCELLED`, so a command never
 * carries on with a missing answer.
 */
interface Prompter {
  text(question: AnyQuestion, validate: Validate): Promise<string>;
  secret(question: AnyQuestion, validate: Validate): Promise<string>;
  select(question: AnyQuestion): Promise<unknown>;
  multiselect(question: AnyQuestion): Promise<unknown[]>;
  confirm(question: AnyQuestion): Promise<boolean>;
}

/**
 * Clack's prompts, the only ones the CLI draws. A wizard draws them inside its
 * chain: the question against a mark, the answer in the guide under it, and
 * `└  Cancelled` when the person walks away. A normal command draws the same
 * prompts without the guide and has no chain to close, so a cancel is left
 * for the run to report as it reports any other.
 */
class DrawnPrompter implements Prompter {
  private readonly guide: boolean;

  constructor(guide: boolean) {
    this.guide = guide;
  }

  /**
   * What every prompt is given besides its question. With the guide, clack
   * draws on the terminal as it is; without it, on a stream that takes the
   * mark and the indent off ({@link flatOutput}), which is the one place a
   * normal command's prompts are made to look as they do.
   */
  private get drawing(): { withGuide: boolean; input?: NodeJS.ReadStream; output?: Writable } {
    if (this.guide) {
      return { withGuide: true };
    }
    return {
      withGuide: false,
      input: process.stdin,
      output: flatOutput(process.stdout),
    };
  }

  async text(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(
      await text({
        message: spelled(question),
        validate,
        initialValue: question.initialValue as string | undefined,
        placeholder: question.placeholder,
        ...this.drawing,
      }),
    );
  }

  async secret(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(
      await password({
        message: spelled(question),
        validate,
        ...this.drawing,
      }),
    );
  }

  async select(question: AnyQuestion): Promise<unknown> {
    return this.chosen(
      await select({
        message: spelled(question),
        options: question.options ?? [],
        initialValue: question.initialValue,
        ...this.drawing,
      }),
    );
  }

  async multiselect(question: AnyQuestion): Promise<unknown[]> {
    return this.chosen(
      await multiselect({
        message: spelled(question),
        options: question.options ?? [],
        required: question.required,
        ...this.drawing,
      }),
    ) as unknown[];
  }

  /**
   * A yes or no. A wizard asks it on one line, as clack does. A normal command
   * asks it as a list of two, so it is answered the way every other choice is:
   * up and down, then Enter. "No" is first, so Enter alone declines.
   */
  async confirm(question: AnyQuestion): Promise<boolean> {
    const initialValue = (question.initialValue as boolean | undefined) ?? false;
    if (this.guide) {
      return this.chosen(
        await confirm({
          message: spelled(question),
          initialValue,
          ...this.drawing,
        }),
      ) as boolean;
    }
    return this.chosen(
      await select<boolean>({
        message: spelled(question),
        options: [
          {
            value: false,
            label: "No",
          },
          {
            value: true,
            label: "Yes",
          },
        ],
        initialValue,
        ...this.drawing,
      }),
    ) as boolean;
  }

  /** A cancelled prompt closes the chain itself, which is all a person is shown. */
  private chosen<T>(answer: T | symbol): T {
    if (isCancel(answer)) {
      if (!this.guide) {
        // The prompt's last frame would otherwise stay on screen as if answered.
        flatOutput(process.stdout).erase();
        throw new ZitadelError("E_CANCELLED", "Cancelled by user");
      }
      cancel(CANCELLED);
      throw new PromptCancelled();
    }
    return answer as T;
  }

  private answered(typed: string | symbol): string {
    return String(this.chosen(typed) ?? "");
  }
}

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
 *    prompt without ({@link Prompter}).
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
 * - `yes-no` returns a boolean. With no one to ask it throws "No <name>
 *   supplied"; `force` never answers it.
 * - `confirm` returns a boolean. The session's `force` (the command's
 *   `--force`) answers it yes without asking. With no one to ask and no
 *   `force`, it throws an `E_CONFIRMATION_REQUIRED` error carrying the
 *   question in `details.question`, for an agent to put to a person.
 *   Only `Consent.request` asks it.
 *
 * Cancelling a prompt (Ctrl-C) throws `E_CANCELLED` instead of returning a
 * sentinel, so a command never carries on with a missing answer, and exits
 * 130 like Ctrl-C anywhere else. A drawn prompt closes its chain with
 * "Cancelled", which is all a person is shown: a cancel is their own
 * decision, not an error. A plain one has no chain to close, so the run says
 * "Cancelled" on a line of its own once the prompt is erased.
 */
async function askOne(
  kind: Kind,
  q: AnyQuestion,
  session: Session,
  prompt: Prompter,
): Promise<unknown> {
  const stdin = session.stdin ?? process.stdin;
  const refusal = (message: string, hint?: string): ZitadelError => {
    return new ZitadelError("E_VALIDATION", message, {
      ...(hint === undefined ? {} : { hint }),
      ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
    });
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
    return refusal(`No ${q.name} supplied`, hint === "" ? undefined : hint);
  };

  if (kind === "confirm") {
    if (session.force) {
      return true;
    }
    if (!session.interactive) {
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
    return drawn(session, () => {
      return prompt.confirm(q);
    });
  }

  if (kind === "yes-no") {
    if (!session.interactive) {
      throw unsupplied();
    }
    return drawn(session, () => {
      return prompt.confirm(q);
    });
  }

  if (kind === "select" || kind === "multiselect") {
    if (!session.interactive) {
      throw unsupplied();
    }
    return drawn(session, () => {
      return kind === "select" ? prompt.select(q) : prompt.multiselect(q);
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
  const typed = await drawn(session, () => {
    return kind === "secret" ? prompt.secret(q, validate) : prompt.text(q, validate);
  });
  return accept(typed);
}

/**
 * Draws a prompt inside the session's hook. The hook sees the prompt throw too,
 * so a spinner paused for the prompt is never left paused.
 */
async function drawn<T>(session: Session, draw: () => Promise<T>): Promise<T> {
  if (session.around === undefined) {
    return draw();
  }
  return session.around(draw);
}

/**
 * {@link Questions} bound to one session. Each method is the engine above with
 * its kind already chosen, which is the only cast in the module: the branches
 * of {@link askOne} cannot see the question's type, so each returns `unknown`
 * and the kind-to-type mapping the overloads promise is trusted here.
 */
class SessionQuestions implements Questions, Confirmer {
  private readonly session: Session;
  private readonly prompt: Prompter;

  constructor(session: Session, prompt: Prompter) {
    this.session = session;
    this.prompt = prompt;
  }

  text<T>(question: TextQuestion<T> & Optional): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  text<T>(question: TextQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return askOne("text", question, this.session, this.prompt) as Promise<T | undefined>;
  }

  secret<T>(question: SecretQuestion<T> & Optional): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  secret<T>(question: SecretQuestion<T> & { optional?: boolean }): Promise<T | undefined> {
    return askOne("secret", question, this.session, this.prompt) as Promise<T | undefined>;
  }

  select<V>(question: SelectQuestion<V>): Promise<V> {
    return askOne("select", question, this.session, this.prompt) as Promise<V>;
  }

  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]> {
    return askOne("multiselect", question, this.session, this.prompt) as Promise<V[]>;
  }

  yesNo(question: YesNoQuestion): Promise<boolean> {
    return askOne("yes-no", question, this.session, this.prompt) as Promise<boolean>;
  }

  confirm(question: ConfirmQuestion): Promise<boolean> {
    return askOne("confirm", question, this.session, this.prompt) as Promise<boolean>;
  }
}

/**
 * The questions as a wizard asks them: drawn inside its chain. Commands
 * get one from `this.ask`, which the UI package builds from the run's audience
 * and its presentation; it takes the session as an argument so it can be
 * tested without a terminal.
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
export function asker(session: Session): Questions & Confirmer {
  return new SessionQuestions(session, new DrawnPrompter(session.guide ?? true));
}
