import type { Writable } from "node:stream";
import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";
import type { Parsed } from "@zitadel/config/idp";

import { CANCELLED, PromptCancelled, ZitadelError } from "@/lib/errors";
import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";

import { FlatOutput } from "./flat-output";
import type { Choice } from "./questions";

/**
 * Which of the six questions is being asked. It is an argument of the engine
 * and never a field of a question: a command picks the kind by calling
 * `Questions.text` or one of its siblings, so there is no string to get
 * wrong and no answer type to cast.
 */
export type Kind = "text" | "secret" | "select" | "multiselect" | "yes-no" | "confirm";

/**
 * Every field any of the six questions can carry, which is what the engine
 * reads. The types in `ui/questions.ts` are the ones a command writes, and
 * each of them is assignable to this.
 */
export type AnyQuestion = {
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

/** How a typed answer is refused as it is typed: the problem, or nothing. */
export type Validate = (value: string | undefined) => string | undefined;

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
export interface Prompter {
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
export class DrawnPrompter implements Prompter {
  private readonly guide: boolean;

  /**
   * @param guide - Whether the prompts are drawn with clack's guide beside them.
   */
  constructor(guide: boolean) {
    this.guide = guide;
  }

  /**
   * Free text, typed in the open.
   *
   * @param question - What is asked.
   * @param validate - Refuses an answer as it is typed.
   * @returns What was typed.
   * @throws {PromptCancelled} When the person walks away from a wizard's prompt.
   * @throws {ZitadelError} `E_CANCELLED` when they walk away from a normal one.
   */
  async text(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(
      await text({
        message: this.spelled(question),
        validate,
        initialValue: question.initialValue as string | undefined,
        placeholder: question.placeholder,
        ...this.drawing,
      }),
    );
  }

  /**
   * Free text, masked as it is typed.
   *
   * @param question - What is asked.
   * @param validate - Refuses an answer as it is typed.
   * @returns What was typed.
   * @throws {PromptCancelled} When the person walks away from a wizard's prompt.
   * @throws {ZitadelError} `E_CANCELLED` when they walk away from a normal one.
   */
  async secret(question: AnyQuestion, validate: Validate): Promise<string> {
    return this.answered(
      await password({
        message: this.spelled(question),
        validate,
        ...this.drawing,
      }),
    );
  }

  /**
   * One of several options.
   *
   * @param question - What is asked, with its options.
   * @returns The chosen option's value.
   * @throws {PromptCancelled} When the person walks away from a wizard's prompt.
   * @throws {ZitadelError} `E_CANCELLED` when they walk away from a normal one.
   */
  async select(question: AnyQuestion): Promise<unknown> {
    return this.chosen(
      await select({
        message: this.spelled(question),
        options: question.options ?? [],
        initialValue: question.initialValue,
        ...this.drawing,
      }),
    );
  }

  /**
   * Any number of several options.
   *
   * @param question - What is asked, with its options.
   * @returns The chosen options' values.
   * @throws {PromptCancelled} When the person walks away from a wizard's prompt.
   * @throws {ZitadelError} `E_CANCELLED` when they walk away from a normal one.
   */
  async multiselect(question: AnyQuestion): Promise<unknown[]> {
    return this.chosen(
      await multiselect({
        message: this.spelled(question),
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
   *
   * @param question - What is asked.
   * @returns Whether the answer is yes.
   * @throws {PromptCancelled} When the person walks away from a wizard's prompt.
   * @throws {ZitadelError} `E_CANCELLED` when they walk away from a normal one.
   */
  async confirm(question: AnyQuestion): Promise<boolean> {
    const initialValue = (question.initialValue as boolean | undefined) ?? false;
    if (this.guide) {
      return this.chosen(
        await confirm({
          message: this.spelled(question),
          initialValue,
          ...this.drawing,
        }),
      ) as boolean;
    }
    return this.chosen(
      await select<boolean>({
        message: this.spelled(question),
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

  /**
   * What every prompt is given besides its question. With the guide, clack
   * draws on the terminal as it is; without it, on a stream that takes the
   * mark and the indent off ({@link FlatOutput}), which is the one place a
   * normal command's prompts are made to look as they do.
   */
  private get drawing(): { withGuide: boolean; input?: NodeJS.ReadStream; output?: Writable } {
    if (this.guide) {
      return { withGuide: true };
    }
    return {
      withGuide: false,
      input: process.stdin,
      output: FlatOutput.of(process.stdout),
    };
  }

  /**
   * A question as a terminal draws it. The question is kept as it came wherever
   * a script reads it (the refusal's hint and `details.question`), so what it
   * names from the server is spelled out here, where it reaches a screen.
   *
   * @param question - What is asked.
   * @returns The question's message, safe to draw.
   */
  private spelled(question: AnyQuestion): string {
    return escapeControlCharacters(question.message);
  }

  /**
   * A cancelled prompt closes the chain itself, which is all a person is shown.
   *
   * @param answer - What the prompt returned.
   * @returns The answer, when there is one.
   * @throws {PromptCancelled} When a wizard's prompt was cancelled.
   * @throws {ZitadelError} `E_CANCELLED` when a normal command's was.
   */
  private chosen<T>(answer: T | symbol): T {
    if (isCancel(answer)) {
      if (!this.guide) {
        // The prompt's last frame would otherwise stay on screen as if answered.
        FlatOutput.of(process.stdout).erase();
        throw new ZitadelError("E_CANCELLED", "Cancelled by user");
      }
      cancel(CANCELLED);
      throw new PromptCancelled();
    }
    return answer as T;
  }

  /**
   * What a text prompt typed, as a string.
   *
   * @param typed - What the prompt returned.
   * @returns The typed text, empty when nothing was typed.
   */
  private answered(typed: string | symbol): string {
    return String(this.chosen(typed) ?? "");
  }
}
