import { ZitadelError, type ZitadelErrorCode } from "../../../lib/errors";
import type { Orca } from "../../../lib/orca";

/** Pass/fail/advisory outcome of a single {@link SanityCheck}. */
export type CheckOutcome = {
  details?: unknown;
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
  /** When true, {@link SanityCheck.fix} must preview without writing. */
  readonly dryRun: boolean;
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
export abstract class AbstractSanityCheck implements SanityCheck {
  abstract readonly name: string;
  abstract readonly path: string;
  protected abstract readonly summary: string;

  /** Throw to signal failure; the thrown message is surfaced to the user. */
  protected abstract verify(ctx: CheckContext): Promise<void>;

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    try {
      await this.verify(ctx);
      return { name: this.name, status: "pass", message: this.summary, path: this.path };
    } catch (error) {
      return {
        name: this.name,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        path: this.path,
        ...(error instanceof ZitadelError
          ? { code: error.code, ...(error.hint === undefined ? {} : { hint: error.hint }) }
          : {}),
      };
    }
  }

  async fix(_ctx: CheckContext): Promise<void> {
    return;
  }
}
