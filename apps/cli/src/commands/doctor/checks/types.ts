import type { Orca } from "../../../lib/orca";

/** Pass/fail outcome of a single {@link SanityCheck}. */
export type CheckOutcome = {
  name: string;
  status: "pass" | "fail";
  message: string;
  path?: string;
};

/** Everything a check needs to inspect a project. */
export type CheckContext = {
  readonly cwd: string;
  readonly orca: Orca;
};

/**
 * One diagnostic the `doctor` command runs. Each concrete check is a small
 * standalone class; the command simply executes every registered check and
 * aggregates the {@link CheckOutcome}s.
 */
export interface SanityCheck {
  run(ctx: CheckContext): Promise<CheckOutcome>;
}

/**
 * Base class for checks: subclasses declare `name`, `path`, and a success
 * `summary`, and implement the single {@link verify} method that throws on
 * failure. {@link run} wraps it so a thrown error becomes a `fail` outcome
 * carrying the error message, and success becomes a `pass` with `summary`.
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
      };
    }
  }
}
