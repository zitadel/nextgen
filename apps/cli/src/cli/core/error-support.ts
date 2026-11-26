import { ZitadelError, ZitadelLibError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { snake } from "@/lib/names";
import type { CommandClass } from "@/lib/oclif/command-class";

import { WORDINGS } from "./error-support/index";
import { refusalError } from "./refusal";

/**
 * The fields of a lib error that are not facts about what failed: what every
 * error carries, which the envelope states in its own fields or not at all.
 */
const UNSPOKEN: ReadonlySet<string> = new Set([
  "name",
  "stack",
  "cause",
  "code",
  "category",
  "retryable",
  "message",
]);

/**
 * Words the lib errors a command lets through. A library raises a typed error
 * that carries the facts of what failed and no words for a person; this is
 * the one place each class is worded, by the wordings in `./error-support/`,
 * one module per lib package, most specific class first. A command catches a
 * class itself only where its own context changes the words.
 *
 * The error's own fields fill the refusal's placeholders and become the
 * envelope's `details`, keyed in snake_case, so the facts reach a script
 * without each refusal listing them.
 *
 * ```ts
 * export abstract class BaseCommand extends ErrorSupport(Loggable(Documented(Interruptible(Command)))) {}
 *
 * // in BaseCommand's catch
 * toZitadelError(this.worded(error, meta.cwd));
 * ```
 *
 * Only `BaseCommand` is built on this, so every command gets it with nothing
 * to wire.
 */
export function ErrorSupport<TBase extends CommandClass>(Base: TBase) {
  abstract class ErrorSupportedCommand extends Base {
    /**
     * A lib error as its wording tells it, or what was thrown as it was.
     *
     * @param error - What the command threw.
     * @param cwd - The folder the run acts on.
     * @returns The refusal its wording makes of a worded lib error, or `error` itself.
     */
    protected worded(error: unknown, cwd: string): unknown {
      if (!(error instanceof ZitadelLibError)) {
        return error;
      }
      const wording = WORDINGS.find(([Class]) => {
        return error instanceof Class;
      });
      if (wording === undefined) {
        return error;
      }
      const [, refusal, derive] = wording;
      const facts = Object.entries(error).filter(([key, value]) => {
        return !UNSPOKEN.has(key) && value !== undefined;
      });
      const extra = derive === undefined ? {} : derive(error, cwd);
      const refused = refusalError(
        {
          code: error.code,
          ...refusal,
        },
        {
          ...Object.fromEntries(facts),
          message: error.message,
          ...extra.values,
        },
        extra.next ?? {},
      );
      const details = {
        ...Object.fromEntries(
          facts.map(([key, value]) => {
            return [snake(key), value];
          }),
        ),
        ...(isObject(refused.details) ? refused.details : {}),
      };

      return new ZitadelError(refused.code, refused.message, {
        hint: refused.hint,
        nextCommands: refused.nextCommands,
        details: Object.keys(details).length === 0 ? undefined : details,
      });
    }
  }

  return ErrorSupportedCommand;
}
