import type { Consent, Gate } from "@/lib/consent";
import { errorMessage, ZitadelError, type ZitadelErrorCode } from "@/lib/errors";
import type { Orca } from "@/lib/orca";
import type { Suggest, SuggestedCommand } from "@/lib/suggestion";

/**
 * Pass/fail/advisory outcome of a single {@link SanityCheck}. One that carries
 * a {@link CheckOutcome.remedy} gives its details as an object, so the
 * envelope can write the remedy into them beside what the check found.
 */
export type CheckOutcome = Readonly<
  | { details?: unknown; remedy?: never }
  | {
      details?: Readonly<Record<string, unknown>>;
      /**
       * The command that repairs a warning, as the check rendered it, and the
       * one place a check gives it: the report quotes it, and the envelope
       * writes it into the check's `details.remedy_command` (`withCategories`).
       */
      remedy: SuggestedCommand;
    }
> & {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  path?: string;
  /**
   * Set when the failure surfaced as a typed CLI error: the error's category
   * and remedy travel through the outcome so the doctor envelope can carry
   * the advertised code (e.g. the framework floor's
   * `E_UNSUPPORTED_PROJECT_SHAPE`) and hint instead of generic advice.
   */
  code?: ZitadelErrorCode;
  hint?: string;
};

/** Everything a check needs to inspect or repair a project. */
export type CheckContext = {
  readonly cwd: string;
  readonly orca: Orca;
  readonly cliVersion: string;
  /** Renders a command a check suggests, with the run's own scope, so it targets the same project. */
  readonly suggest: Suggest;
  /** When true, {@link SanityCheck.fix} must preview without writing. */
  readonly dryRun: boolean;
  /** Aborts what a check has in flight, as Ctrl-C does for the command running it. */
  readonly signal: AbortSignal;
  /**
   * Asks for consent to a destructive repair: `doctor`'s own confirmation,
   * which `--force` answers. `undefined` is a no. Never called on a dry run.
   */
  readonly consent: (gate: Gate) => Promise<Consent | undefined>;
};

/**
 * One diagnostic the `doctor` command runs. Each concrete check is a small
 * standalone class that both verifies its concern ({@link run}) and knows how
 * to repair it ({@link fix}); the command executes every registered check,
 * aggregates the {@link CheckOutcome}s, and (under `--fix`) repairs the ones
 * that failed.
 */
export interface SanityCheck {
  /** Stable identifier surfaced in logs and the JSON envelope. */
  readonly name: string;
  run(ctx: CheckContext): Promise<CheckOutcome>;
  /** Repair what this check verifies. A no-op when there is no safe auto-fix. */
  fix(ctx: CheckContext): Promise<void>;
}

/**
 * Base class for checks: subclasses declare `name`, `path`, and a success
 * `summary`, and implement the single {@link verify} method that throws on
 * failure. {@link run} wraps it so a thrown error becomes a `fail` outcome
 * carrying the error message, and success becomes a `pass` with `summary`.
 *
 * {@link fix} defaults to a no-op: checks whose failure has no safe automatic
 * remedy (a missing secret, an invalid user schema) simply do not override it.
 */
/**
 * A failure that carries facts for the report: the outcome that reports it
 * puts `details` beside the message.
 */
export class CheckFailure extends Error {
  readonly details: CheckOutcome["details"];

  /**
   * @param message - What is wrong, in one sentence.
   * @param details - The facts behind it, for the report.
   */
  constructor(message: string, details: CheckOutcome["details"]) {
    super(message);
    this.details = details;
  }
}

export abstract class AbstractSanityCheck implements SanityCheck {
  /**
   * Runs `run` and reports it as a check: a pass with what it returned, or the
   * failure it threw as `failureStatus`, with the details a {@link CheckFailure}
   * carries.
   *
   * @param name - The check's name.
   * @param fallback - The message when what was thrown is not an error.
   * @param run - The probe; it returns the passing message and throws to fail.
   * @param failureStatus - What a failure counts as.
   * @returns The check's outcome.
   */
  static async attempt(
    name: string,
    fallback: string,
    run: () => Promise<string>,
    failureStatus: "warn" | "fail" = "fail",
  ): Promise<CheckOutcome> {
    try {
      return {
        name,
        status: "pass",
        message: await run(),
      };
    } catch (error) {
      if (error instanceof CheckFailure) {
        return {
          name,
          status: failureStatus,
          message: error.message,
          details: error.details,
        };
      }
      return {
        name,
        status: failureStatus,
        message: error instanceof Error ? error.message : fallback,
      };
    }
  }

  abstract readonly name: string;
  abstract readonly path: string;
  protected abstract readonly summary: string;

  /** Throw to signal failure; the thrown message is surfaced to the user. */
  protected abstract verify(ctx: CheckContext): Promise<void>;

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    try {
      await this.verify(ctx);
      return {
        name: this.name,
        status: "pass",
        message: this.summary,
        path: this.path,
      };
    } catch (error) {
      return {
        name: this.name,
        status: "fail",
        message: isMissingFile(error) ? `${this.path} was not found` : errorMessage(error),
        path: this.path,
        ...(error instanceof ZitadelError
          ? {
              code: error.code,
              ...(error.hint === undefined ? {} : { hint: error.hint }),
            }
          : {}),
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    return;
  }
}

/** A read that found no file: named by the check's own path, not the system's error and absolute path. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
