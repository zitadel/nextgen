import { originalOf, ZitadelError, ZitadelLibError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import type { CommandClass } from "@/lib/oclif/command-class";

import { WORDINGS } from "./error-support/index";
import { refusalError } from "./refusal";

/**
 * Advises on the lib errors a command lets through. A library raises a typed
 * error that states its own message, a hint about the world where it has one,
 * and its facts as `details`; the CLI adds only what names its own commands
 * and flags: a hint that names one, and the commands to run next. Each class
 * that needs that has one wording in `./error-support/`, one module per lib
 * package, for exactly that class; every other lib error, a subclass of one
 * included, is reported as it states itself.
 *
 * A wording's `{name}` placeholders are filled from the error's fields, its
 * message and `{original}`: the error it stands for (its `cause` when that is
 * an error, else itself) as its name, message and errno. A wording that names
 * its own `details` reports that set in place of the error's facts. A command
 * catches a class itself only where its own context changes the words.
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
     * A lib error with the CLI's advice, or what was thrown as it was.
     *
     * @param error - What the command threw.
     * @param cwd - The folder the run acts on.
     * @returns The error its wording advises on a lib error that has one, or `error` itself.
     */
    protected worded(error: unknown, cwd: string): unknown {
      return wordedError(error, cwd);
    }
  }

  return ErrorSupportedCommand;
}

/**
 * A lib error with the CLI's advice, or what was thrown as it was: the one
 * wording every command's failure and every doctor check's outcome go
 * through.
 *
 * @param error - What was thrown.
 * @param cwd - The folder the run acts on.
 * @returns The error its wording advises on a lib error that has one, or `error` itself.
 */
export function wordedError(error: unknown, cwd: string): unknown {
  if (!(error instanceof ZitadelLibError)) {
    return error;
  }
  // A wording advises exactly its class: a subclass that has none states
  // itself, its own hint included.
  const wording = WORDINGS.find(([Class]) => {
    return Object.getPrototypeOf(error) === Class.prototype;
  });
  if (wording === undefined) {
    return error;
  }
  const [, advice, derive] = wording;
  const extra = derive === undefined ? {} : derive(error, cwd);
  const refused = refusalError(
    {
      message: "{message}",
      ...advice,
    },
    {
      ...Object.fromEntries(
        Object.entries(error).filter(([, value]) => {
          return value !== undefined;
        }),
      ),
      message: error.message,
      original: originalOf(error),
      ...extra.values,
    },
    extra.next ?? {},
  );
  const stated = isObject(refused.details) ? refused.details : {};
  const details = advice.details === undefined ? error.details : stated;

  return new ZitadelError(error.code, error.message, {
    hint: refused.hint ?? error.hint,
    nextCommands: refused.nextCommands?.length === 0 ? undefined : refused.nextCommands,
    details: Object.keys(details).length === 0 ? undefined : details,
  });
}
