import type { ZitadelErrorCode, ZitadelLibError } from "@/lib/errors";
import type { Suggested } from "@/lib/suggestion";

/**
 * What a person or a script is shown of a failure: the envelope's `code`,
 * `message`, `hint`, `details` and `next_commands` (before the run renders
 * them), and the code the process exits with.
 */
export type Shown = Readonly<{
  /** The envelope's `code`. */
  code: ZitadelErrorCode;
  /** The envelope's `message`. */
  message: string;
  /** The envelope's `hint`, when it has one. */
  hint?: string;
  /** The envelope's `details`, with their values, when it has any. */
  details?: Readonly<Record<string, unknown>>;
  /** The follow-ups, as the failure names them before the run renders them. */
  next?: readonly Suggested[];
  /** The code the process exits with. */
  exitCode: number;
}>;

/**
 * Where the branch shows a failure differently from main on purpose: what it
 * shows instead, and why, so the difference is visible rather than hidden.
 */
export type Deviation = Readonly<{
  /** Why the branch differs, in one line. */
  reason: string;
  /** What the branch shows instead of main's. */
  shown: Partial<Shown>;
}>;

/**
 * One lib error with sample facts, and what main showed for the same failure
 * with the same facts.
 */
export type Row = Readonly<{
  /** Which situation of its class the row samples, where a class has more than one. */
  case?: string;
  /** The error, built with sample facts and the message its throw site builds from them. */
  error: ZitadelLibError;
  /** Main's emission site for the same failure, `path:line` under `apps/cli/src`. */
  main: string;
  /** What main showed. */
  expected: Shown;
  /** Where the branch deliberately shows something else. */
  deviation?: Deviation;
}>;

/** The folder every row's run acts on. */
export const CWD = "/work/app";
