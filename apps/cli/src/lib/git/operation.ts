import type { Git } from "./git";

/**
 * Something that must hold before an operation runs.
 *
 * One class per condition, in `checks/`, each answering with the problem in
 * words for the developer or null. Keeping conditions out of the operations
 * means each can be tested alone, against every answer git can give, and an
 * operation's preconditions read as a list.
 */
export interface Check {
  /** Why it does not hold, in words for the developer, or null when it does. */
  problem(git: Git): Promise<string | null>;
}

/**
 * One thing a {@link Repository} does, run by {@link Repository.perform}.
 *
 * Every operation has the same three parts, so they all read alike: the
 * checks that must hold, what it answers when one does not, and the work.
 * `perform` runs the checks in order and calls `refused` with the first
 * problem, or `run` when there is none. An operation with no checks still has
 * a `refused`, for the shape's sake; it is never called.
 */
export interface Operation<T> {
  /** What must hold before it runs. */
  checks(): Check[];
  /** What it returns instead of running, when a check does not hold. */
  refused(problem: string): T;
  /** What it does. */
  run(git: Git): Promise<T>;
}
