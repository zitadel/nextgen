/**
 * An action that runs the first time it is asked for and never again, for a
 * step that may be ended from several places.
 */
export class Once {
  /** Whether the action has been given to {@link Once.run} yet. */
  private ran = false;

  /**
   * Whether the action has already run.
   *
   * @returns `true` once {@link Once.run} has been given an action.
   */
  get hasRun(): boolean {
    return this.ran;
  }

  /**
   * Runs `action` unless an earlier call already did.
   *
   * @param action - What to do, the first time only.
   */
  run(action: () => void): void {
    if (this.ran) {
      return;
    }
    this.ran = true;
    action();
  }
}
