import { resolve } from "node:path";

import { Cmd } from "@/lib/cmd";
import { failureText, toZitadelError, ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { LocalServerError } from "@/lib/server";
import { LOCAL_SERVER_ADVICE, type LocalServerAdvice } from "@/lib/suggestion/local-server-advice";
import {
  isSuggestion,
  shellCommand,
  Spelling,
  type Suggested,
  type SuggestedCommand,
} from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Summary } from "@/lib/ui";
import { NEXT_LABEL } from "@/lib/ui/summary";

import { advised } from "./advice";
import { interpolate } from "./refusal";
import type { ErrorEnvelope, GlobalOptions } from "./types";

/**
 * A failure as every rendering of it states it: the envelope `--json` writes
 * and the summary a terminal draws. It is the only place a failure becomes
 * words for a person, so there is one grammar however the failure arose — the
 * CLI's own refusal, the platform's, a socket that never answered, or oclif
 * refusing the command line.
 *
 * ```ts
 * const failure = new Failure(error, meta, help);
 * failure.envelope(); // what --json writes
 * failure.summary(); // what a terminal draws
 * ```
 */
export class Failure {
  /** The failure as it is reported: oclif's refusal of a command line says its first line and points at the help. */
  readonly error: ZitadelError;

  /** The run the failure ended. */
  private readonly meta: GlobalOptions;

  /**
   * @param error - The failure, its follow-ups rendered for this run.
   * @param meta - The run it ended.
   * @param help - The help of the command the run named, for a command line oclif refused.
   */
  constructor(error: ZitadelError, meta: GlobalOptions, help: SuggestedCommand) {
    this.meta = meta;
    const { sentence, misuse } = failureText(error.message);
    this.error = misuse
      ? new ZitadelError(error.code, sentence, {
          hint: error.hint,
          nextCommands: error.nextCommands?.length ? error.nextCommands : [help],
        })
      : error;
  }

  /**
   * A failure of the local server with the advice for it: the server package
   * names what failed, and this says what to do about it. Where the failing
   * record or file sits in another folder than this run's, the commands it
   * suggests carry that folder's `--cwd`, so they fix the right one.
   *
   * @param error - What the command threw.
   * @param cwd - The folder this run acts on, from the settled meta.
   * @returns The error with its hint and next commands, or the error as it was.
   */
  static advised(error: unknown, cwd: string): unknown {
    if (!(error instanceof LocalServerError)) {
      return advised(error);
    }
    const key = error.advice;
    if (key === undefined) {
      return error;
    }
    const advice: LocalServerAdvice = LOCAL_SERVER_ADVICE[key];
    const details: Record<string, unknown> = isObject(error.details) ? { ...error.details } : {};
    const { directory } = details;
    const elsewhere = typeof directory === "string" && resolve(directory) !== resolve(cwd);
    const removal: Suggested[] =
      key === "admin-malformed" && typeof details.path === "string"
        ? [shellCommand("rm", Cmd.quote(details.path))]
        : [];
    const steps = (advice.next ?? []).map((step) => {
      if (elsewhere && typeof step === "object" && (step.id === "reset" || step.id === "start")) {
        const flags = { ...("flags" in step ? step.flags : undefined), cwd: directory };

        return {
          next: { ...step, flags } as Suggested,
          args: [
            step.id,
            ...Object.entries(flags).flatMap(([name, value]) => {
              if (value === true) {
                return [`--${name}`];
              } else {
                return [`--${name}`, String(value)];
              }
            }),
          ],
        };
      } else {
        return { next: step, args: undefined };
      }
    });
    const next = steps.map((step) => {
      return step.next;
    });
    const retargeted = steps.flatMap((step) => {
      return step.args === undefined ? [] : [step.args];
    });
    const quoted = {
      ...details,
      ...Object.fromEntries(
        ["directory", "path"].flatMap((key) => {
          const value = details[key];

          return typeof value === "string" ? [[key, Cmd.quote(value)]] : [];
        }),
      ),
    };
    const hint = [elsewhere && advice.elsewhere, advice.hint].find((text) => {
      return typeof text === "string";
    });
    const visible = {
      ...Object.fromEntries(
        Object.entries(details).filter(([key]) => {
          return key !== "directory";
        }),
      ),
      ...(retargeted.length > 0 ? { suggested_args: retargeted } : {}),
    };
    return new ZitadelError(toZitadelError(error).code, error.message, {
      hint: interpolate(hint ?? advice.hint, quoted),
      nextCommands: [...removal, ...next],
      details: error.details && visible,
    });
  }

  /**
   * The failure envelope `--json` writes.
   *
   * @returns The envelope, its follow-ups as the commands the run rendered.
   */
  envelope(): ErrorEnvelope {
    const { error, meta } = this;

    return {
      status: "error",
      cli_version: meta.cliVersion,
      command: meta.command,
      source: meta.source,
      code: error.code,
      message: error.message,
      hint:
        error.hint === undefined ? undefined : Spelling.at(meta.cliVersion).spellOut(error.hint),
      next_commands: error.nextCommands === undefined ? undefined : this.commands(),
      details: error.details,
    };
  }

  /**
   * The failure as a person is shown it: the coded sentence, an optional hint,
   * and any commands to run next. A failure names what it failed on — an
   * origin, an id, a value — so the message and the hint carry what the server
   * answered as readily as a success's rendering does, and are spelled out here
   * for the same reason. The envelope keeps them as they came, so a reader
   * parses the real text. Only the label is coloured, so there is nothing for
   * the spelling to undo.
   *
   * @returns The summary.
   */
  summary(): Summary {
    const { error, meta } = this;
    const commands = this.commands();

    return {
      title: `Error: ${escapeControlCharacters(Spelling.at(meta.cliVersion).spellOut(error.message))} (${error.code})`,
      sections: [],
      lines: error.hint
        ? [escapeControlCharacters(Spelling.at(meta.cliVersion).spellOut(error.hint))]
        : [],
      ...(commands.length === 0
        ? {}
        : {
            next: [
              {
                text: NEXT_LABEL,
                command: commands.join("\n"),
              },
            ],
            boxed: true,
          }),
      failed: true,
    };
  }

  /**
   * The failure's follow-ups, each rendered before the failure is reported.
   *
   * @returns Its follow-ups.
   * @throws {Error} When one was left for a run to render, which is a defect in the handler.
   */
  private commands(): SuggestedCommand[] {
    return (this.error.nextCommands ?? []).map((next) => {
      if (isSuggestion(next)) {
        throw new Error(`${next.id} was reported without being rendered`);
      }

      return next;
    });
  }
}
