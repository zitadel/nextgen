import { test as base, vi } from "vitest";

/** What a spec drives once the clock is faked. */
export interface Clock {
  /**
   * Moves the faked time forward, running the timers that come due.
   *
   * @param ms - How far to move, in milliseconds.
   */
  advance(ms: number): void;
  /**
   * Moves the faked `Date` forward without running any timer.
   *
   * @param ms - How far to move, in milliseconds.
   */
  skip(ms: number): void;
  /** Runs every pending timer. */
  runAll(): void;
}

/** The `toFake` list of Vitest's `vi.useFakeTimers`. */
type FakeTimerOptions = Parameters<typeof vi.useFakeTimers>[0];

/**
 * Builds the `it` of a spec file whose tests share one fake clock.
 *
 * Fake timers are installed before a test that names `clock` and removed
 * afterwards, so no spec restores them by hand.
 *
 * @param options - Which timers to fake; all of them when omitted.
 * @returns The Vitest `it` extended with `clock`.
 */
export function clockTest(options?: FakeTimerOptions) {
  return base.extend<{ clock: Clock }>({
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    clock: async ({}, use) => {
      vi.useFakeTimers(options);
      await use({
        advance: (ms) => {
          vi.advanceTimersByTime(ms);
        },
        skip: (ms) => {
          vi.setSystemTime(Date.now() + ms);
        },
        runAll: () => {
          vi.runAllTimers();
        },
      });
      vi.useRealTimers();
    },
  });
}

/** `it` with every timer faked. */
export const test = clockTest();

/** Alias of {@link test}. */
export const it = test;

/** `it` with only `Date` faked, for code that reads the time while real I/O settles. */
export const dateTest = clockTest({ toFake: ["Date"] });

/** `it` with the animation-frame timers and `performance` faked. */
export const frameTest = clockTest({
  toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
});
