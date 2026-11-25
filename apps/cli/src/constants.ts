/**
 * The server `ZitadelRuntime.resolve()` returns when no `--server` is given. A
 * command that talks to a project resolves its server from `ZITADEL_URL`
 * instead, as `Environment` reads it. This is the one place the CLI names a
 * hosted server; every default, example, hint and host check reads it.
 */
export const SERVER = "https://preview.zitadel.com";

/**
 * The closed set of kinds a failure can be, shared by every package's errors.
 *
 * @remarks
 * A package's base error carries one of these as `category`, so the command
 * that catches it, and the boundary that finally reports it, can say what
 * kind of failure it was without knowing which package raised it.
 *
 * - `validation`: what the user gave, or a file of theirs, is wrong.
 * - `not_found`: the thing asked for does not exist.
 * - `conflict`: the state of the world refuses the request.
 * - `auth`: not signed in, or not allowed.
 * - `unavailable`: no usable answer; trying again later may work.
 * - `unsupported`: a shape or version this CLI does not handle.
 * - `precondition`: something that has to be in place first is not.
 * - `internal`: a bug in our own code.
 * - `unexpected`: something failed that nobody anticipated; there is no
 *   guidance to give.
 */
export const ERROR_CATEGORIES = [
  "validation",
  "not_found",
  "conflict",
  "auth",
  "unavailable",
  "unsupported",
  "precondition",
  "internal",
  "unexpected",
] as const;

/** One of the {@link ERROR_CATEGORIES}. */
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** What an error carries when it says what kind of failure it is. */
export interface Categorized {
  /** The kind of failure. */
  readonly category: ErrorCategory;
  /** What to do about it, when the package that raised it knows. */
  readonly hint?: string | undefined;
  /** Structured facts about the failure, for a `--json` reader. */
  readonly details?: unknown;
}
