import type { Git } from "./git";

/** Something that must hold before an operation runs. */
export interface Check {
  /** Why it does not hold, in words for the developer, or null when it does. */
  problem(git: Git): Promise<string | null>;
}

/** One thing a {@link Repository} does, run by {@link Repository.perform}. */
export interface Operation<T> {
  /** What must hold before it runs. */
  checks(): Check[];
  /** What it returns instead of running, when a check does not hold. */
  refused(problem: string): T;
  /** What it does. */
  run(git: Git): Promise<T>;
}
