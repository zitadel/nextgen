import type {
  ConfirmQuestion,
  MultiselectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./questions";

/**
 * What a command can do while its chain is open. It is reachable only inside
 * `ui.wizard(...)`, so a command cannot ask a question outside a chain, and the
 * chain cannot be left open: it is drawn when the callback is entered and
 * closed on the outcome the callback returns.
 */

/** What a {@link Wizard.task} reports, one line each, under the task's result. */
export interface Report {
  /** Something was done: `Wrote  .zitadel/idps/google.json`. */
  done(verb: string, subject: string): void;
  /** Something was left alone on purpose: `– Left  flows/default-login.json`. */
  skipped(verb: string, subject: string): void;
  /** Something to look at: `! Check  no claim_mapping`. */
  warning(verb: string, subject: string): void;
}

/** One stretch of work, begun with {@link Wizard.begin}, ended once. */
export interface Step {
  /** A line of detail, such as one file written, listed under the result. */
  detail(text: string): void;
  /** Ends the step, with its result as the line. */
  done(text?: string): void;
  /** Ends the step as failed. The error itself is shown by the ending. */
  fail(text?: string): void;
}

export interface Wizard {
  /** Free text. With `optional: true`, `undefined` when nothing was given. */
  text<T>(question: TextQuestion<T> & { optional: true }): Promise<T | undefined>;
  text<T>(question: TextQuestion<T>): Promise<T>;
  /** Masked text, never a flag, never echoed. */
  secret<T>(question: SecretQuestion<T> & { optional: true }): Promise<T | undefined>;
  secret<T>(question: SecretQuestion<T>): Promise<T>;
  select<V>(question: SelectQuestion<V>): Promise<V>;
  multiselect<V>(question: MultiselectQuestion<V>): Promise<V[]>;
  /** Yes or no. The command's `--force` answers it yes without asking. */
  confirm(question: ConfirmQuestion): Promise<boolean>;
  /**
   * Something the person must read or go and do outside the terminal, such as
   * registering an OAuth app. It is the only boxed thing inside a chain; what
   * merely happened is a {@link task}'s line, and what is left to do is the
   * summary's next steps.
   */
  note(title: string, lines: readonly string[]): void;
  /**
   * Work that takes a moment, as a callback: a spinner while it runs, then its
   * result as one line with whatever it reported under it.
   */
  task<T>(
    label: string,
    work: (report: Report) => Promise<T>,
    done?: (result: T) => string,
  ): Promise<T>;
  /**
   * The same, for work the surrounding code cannot wrap in a callback — a long
   * run of steps with its own error handling. Prefer {@link task}: a step begun
   * here must be ended by hand.
   */
  begin(label: string): Step;
}
