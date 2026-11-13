/**
 * An action that runs the first time it is asked for and never again, for a
 * step that may be ended from several places.
 */
export class Once {
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

/**
 * A value made on first use and shared by every use after it, for a read that
 * is only worth starting when something needs it.
 */
export class Lazy<T> {
  private readonly make: () => T;

  private made: { readonly value: T } | undefined;

  /**
   * @param make - Builds the value; called at most once.
   */
  constructor(make: () => T) {
    this.make = make;
  }

  /**
   * The value, made by the first call.
   *
   * @returns What {@link Lazy}'s `make` returned the first time.
   */
  get(): T {
    this.made ??= { value: this.make() };
    return this.made.value;
  }
}
