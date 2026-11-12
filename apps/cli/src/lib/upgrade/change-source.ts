/** One breaking change a release announced. */
export type BreakingChange = Readonly<{ version: string; note: string }>;

/** Where the notes of the releases an upgrade crosses are read from. */
export interface ChangeSource {
  /**
   * The breaking changes of every release after `from`, up to and including `to`,
   * oldest first.
   *
   * @param from - The oldest version involved, which is excluded.
   * @param to - The version being upgraded to.
   * @returns The changes; empty when there are none or they could not be read.
   */
  breakingChanges(from: string, to: string): Promise<readonly BreakingChange[]>;
}
