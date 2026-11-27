/**
 * Time, as the code that waits for something sees it. Waiting for a server to
 * answer, or for another start to finish, polls; taking the clock as a
 * dependency lets a test move time by hand instead of waiting for it.
 */
export interface Clock {
  now(): number;
  /** Waits `ms`, or until `signal` aborts if that comes first. */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
}

/** The clock of the machine the CLI runs on. */
export class SystemClock implements Clock {
  /**
   * @returns The milliseconds since the epoch.
   */
  now(): number {
    return Date.now();
  }

  /**
   * @param ms - How long to wait.
   * @param signal - Ends the wait early; ending it is not an error.
   */
  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    // Node's timer rejects an abort with an internal `AbortError` that has no
    // exported class, so the wait is built on the signal's event instead.
    if (signal?.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal?.addEventListener("abort", stop, {
        once: true,
      });
    });
  }
}
