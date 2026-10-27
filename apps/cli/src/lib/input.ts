import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";

import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError, CANCELLED } from "./errors";
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
  /** The stream a plainly asked question is written to. Defaults to the process's stdout. */
  stdout?: NodeJS.WritableStream;
  /** Called just before a prompt is drawn, so the caller can open the chain it belongs to. */
  before?: () => void;
  /** Called when a prompt has been answered, so the caller can space what follows it. */
  after?: () => void;
};

/** The one thing a cancelled prompt throws, whichever prompter was asking. */
const cancelledByUser = (): ZitadelError => new ZitadelError("E_CANCELLED", "Cancelled by user");

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
 * Clack's prompts, which a wizard draws inside its chain: the question against
 * a mark, the answer in the gutter under it, and `└  Cancelled.` when the
 * person walks away.
 */
class DrawnPrompter implements Prompter {
  async text(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(
      await text({
        message: question.message,
        validate,
        initialValue: question.initialValue as string | undefined,
        placeholder: question.placeholder,
      }),
    );
  }

  async secret(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(await password({ message: question.message, validate }));
  }

  async select(question: AnyQuestion): Promise<unknown> {
    return this.chosen(
      await select({
        message: question.message,
        options: question.options ?? [],
        initialValue: question.initialValue,
      }),
    );
  }

  async multiselect(question: AnyQuestion): Promise<unknown[]> {
    return this.chosen(
      await multiselect({
        message: question.message,
        options: question.options ?? [],
        required: question.required,
      }),
    ) as unknown[];
  }

  async confirm(question: AnyQuestion): Promise<boolean> {
    return this.chosen(
      await confirm({
        message: question.message,
        initialValue: (question.initialValue as boolean | undefined) ?? false,
      }),
    ) as boolean;
  }

  /** A cancelled prompt closes the chain itself, which is all a person is shown. */
  private chosen<T>(answer: T | symbol): T {
    if (isCancel(answer)) {
      cancel(CANCELLED);
      throw cancelledByUser();
    }
    return answer as T;
  }

  private answered(typed: string | symbol): string {
    return String(this.chosen(typed) ?? "");
  }
}

/**
 * A question asked plainly, which is how a normal command asks: the question,
 * a space, and the answer typed on the same line. No frame, no gutter and no
 * mark — a normal command's output is its answer, and a question it happened
 * to ask must not turn that into a wizard.
 *
 * `node:readline` reads the line without taking the terminal over, so the tty
 * echoes what is typed and Ctrl-C is the interrupt it is everywhere else. A
 * choice is numbered, since a list that cannot be arrowed through has to be
 * one a person can name, and an answer that does not parse is said to be
 * wrong and asked for again, exactly as the drawn prompt refuses one.
 */
class PlainPrompter implements Prompter {
  private readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  async text(question: AnyQuestion, validate: Validate): Promise<string> {
    const initial = question.initialValue as string | undefined;
    const suffix = initial === undefined ? "" : ` [${initial}]`;
    for (;;) {
      const typed = await this.read(`${question.message}${suffix} `);
      const answer = typed.trim() === "" && initial !== undefined ? initial : typed;
      const problem = validate(answer);
      if (problem === undefined) {
        return answer;
      }
      this.say(problem);
    }
  }

  async secret(question: AnyQuestion, validate: Validate): Promise<string> {
    for (;;) {
      const typed = await this.read(`${question.message} `, true);
      const problem = validate(typed);
      if (problem === undefined) {
        return typed;
      }
      this.say(problem);
    }
  }

  async select(question: AnyQuestion): Promise<unknown> {
    const choices = this.list(question);
    const initial = choices.findIndex((choice) => choice.value === question.initialValue);
    const prompt = `[1-${choices.length}]${initial < 0 ? "" : ` (${initial + 1})`} `;
    for (;;) {
      const typed = (await this.read(prompt)).trim();
      if (typed === "" && initial >= 0) {
        return choices[initial]?.value;
      }
      const picked = this.pick(typed, choices.length);
      if (picked !== undefined) {
        return choices[picked]?.value;
      }
      this.say(`Please answer with a number between 1 and ${choices.length}.`);
    }
  }

  async multiselect(question: AnyQuestion): Promise<unknown[]> {
    const choices = this.list(question);
    const prompt = `[1-${choices.length}, separated by commas] `;
    for (;;) {
      const typed = (await this.read(prompt)).trim();
      if (typed === "") {
        if (question.required === false) {
          return [];
        }
        this.say("Please answer with at least one number.");
        continue;
      }
      const picked = typed.split(",").map((part) => this.pick(part.trim(), choices.length));
      if (picked.every((at) => at !== undefined)) {
        return picked.map((at) => choices[at]?.value);
      }
      this.say(`Please answer with numbers between 1 and ${choices.length}, separated by commas.`);
    }
  }

  async confirm(question: AnyQuestion): Promise<boolean> {
    const initial = question.initialValue === true;
    for (;;) {
      const typed = (await this.read(`${question.message} ${initial ? "[Y/n]" : "[y/N]"} `))
        .trim()
        .toLowerCase();
      if (typed === "") {
        return initial;
      }
      if (typed === "y" || typed === "yes") {
        return true;
      }
      if (typed === "n" || typed === "no") {
        return false;
      }
      this.say("Please answer yes or no.");
    }
  }

  /**
   * The choices a person can name, numbered from one in the order the question
   * put them. A disabled one is shown with its hint, so a choice that exists
   * but is not available yet still reads as a choice, and is left unnumbered
   * so there is no number that answers it.
   */
  private list(question: AnyQuestion): Choice<unknown>[] {
    const options = question.options ?? [];
    const choosable = options.filter((option) => option.disabled !== true);
    this.say(question.message);
    for (const option of options) {
      const at = choosable.indexOf(option);
      const hint = option.hint === undefined ? "" : ` — ${option.hint}`;
      this.say(`  ${at < 0 ? "-" : at + 1})  ${option.label}${hint}`);
    }
    return choosable;
  }

  /** The option `typed` names, as an index, or nothing when it names none. */
  private pick(typed: string, count: number): number | undefined {
    const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1;
    return at >= 0 && at < count ? at : undefined;
  }

  /** One line of our own: the question's own listing, or why an answer was refused. */
  private say(text_: string): void {
    (this.session.stdout ?? process.stdout).write(`${text_}\n`);
  }

  /**
   * Writes `query` and gives back the line that was typed after it.
   *
   * Nothing is masked unless it has to be: the terminal is left in its own
   * mode, so it echoes the answer beside the question and a Ctrl-C is the
   * interrupt it would be at a shell prompt. A secret cannot be echoed, so
   * that one line is read with the terminal taken over and everything after
   * the question swallowed. Either way, an input that ends without an answer
   * is the person walking away, not an empty answer.
   */
  private async read(query: string, masked = false): Promise<string> {
    const input = this.session.stdin ?? process.stdin;
    const out = this.session.stdout ?? process.stdout;
    const rl = createInterface({
      input,
      output: masked ? new Swallowing(out, query) : out,
      terminal: masked,
    });
    rl.on("SIGINT", () => rl.close());
    try {
      return await new Promise<string>((resolve, reject) => {
        rl.once("close", () => reject(cancelledByUser()));
        rl.question(query).then(resolve, reject);
      });
    } finally {
      rl.close();
      if (masked) {
        out.write("\n");
      }
    }
  }
}

/**
 * The output of a masked question: the question goes through once, and every
 * keystroke the line editor would echo after it goes nowhere.
 *
 * Exported for its own test: what it does cannot be seen from outside, since
 * a line editor fed programmatically echoes nothing to begin with, so a test
 * driving a whole question could not tell masking from its absence.
 */
export class Swallowing extends Writable {
  private readonly target: NodeJS.WritableStream;
  private readonly query: string;
  private asked = false;

  constructor(target: NodeJS.WritableStream, query: string) {
    super();
    this.target = target;
    this.query = query;
  }

  override _write(_chunk: unknown, _encoding: unknown, done: (error?: Error | null) => void): void {
    if (!this.asked) {
      this.asked = true;
      this.target.write(this.query);
    }
    done();
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
 *    its chain and a normal command's is one plain line ({@link Prompter}).
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
 * 130 like Ctrl-C anywhere else. A drawn prompt closes its chain with
 * "Cancelled.", which is all a person is shown: a cancel is their own
 * decision, not an error. A plain one has no chain to close and says nothing.
 */
async function askOne(
  kind: Kind,
  q: AnyQuestion,
  session: Session,
  prompt: Prompter,
): Promise<unknown> {
  const stdin = session.stdin ?? process.stdin;
  const refusal = (message: string, hint?: string): ZitadelError =>
    new ZitadelError("E_VALIDATION", message, {
      ...(hint === undefined ? {} : { hint }),
      ...(q.retry === undefined ? {} : { nextCommands: [q.retry] }),
    });
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
    const confirmed = await prompt.confirm(q);
    session.after?.();
    return confirmed;
  }

  if (kind === "select" || kind === "multiselect") {
    if (!session.interactive) {
      throw unsupplied();
    }
    session.before?.();
    const chosen = kind === "select" ? await prompt.select(q) : await prompt.multiselect(q);
    session.after?.();
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
    kind === "secret" ? await prompt.secret(q, validate) : await prompt.text(q, validate);
  session.after?.();
  return accept(typed);
}

/**
 * {@link Questions} bound to one session. Each method is the engine above with
 * its kind already chosen, which is the only cast in the module: the branches
 * of {@link askOne} cannot see the question's type, so each returns `unknown`
 * and the kind-to-type mapping the overloads promise is trusted here.
 */
class SessionQuestions implements Questions {
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

  confirm(question: ConfirmQuestion): Promise<boolean> {
    return askOne("confirm", question, this.session, this.prompt) as Promise<boolean>;
  }
}

/**
 * The five questions as a wizard asks them: drawn inside its chain. Commands
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
export function asker(session: Session): Questions {
  return new SessionQuestions(session, new DrawnPrompter());
}

/**
 * The same five questions as a normal command asks them: one plain line with
 * the answer typed on it. Everything but the prompt itself is the same rule —
 * a flag answers first, then a pipe, then the person, and a run with nobody to
 * ask refuses by the question's own name — so a command's code is identical
 * whichever of the two it is handed.
 */
export function plainAsker(session: Session): Questions {
  return new SessionQuestions(session, new PlainPrompter(session));
}
