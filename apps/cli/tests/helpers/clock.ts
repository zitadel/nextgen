import { vi } from "vitest";

import type { Clock } from "@/lib/local-server/internal/clock";
import { test as base } from "./terminal";

/**
 * A clock that only moves when something waits on it, by exactly as long as it
 * waits, so a test that depends on time never has to spend any.
 */
export class ManualClock implements Clock {
  private time = 0;
  private readonly onWait: () => void;

  constructor(onWait: () => void = () => undefined) {
    this.onWait = onWait;
  }

  now(): number {
    return this.time;
  }

  async wait(ms: number): Promise<void> {
    this.time += ms;
    this.onWait();
  }
}

/** What Vitest can be told to fake: the names a test passes to {@link TimeControls.only}. */
export type FakedTimers = NonNullable<
  NonNullable<Parameters<typeof vi.useFakeTimers>[0]>["toFake"]
>;

/** Time that moves only when a test moves it. */
export interface TimeControls {
  /** Moves time forward by `ms`, running every timer that comes due, without yielding to promises. */
  advance(ms: number): void;
  /** Moves time forward by `ms`, letting the promises that timers resolve run between timers. */
  advanceAsync(ms: number): Promise<void>;
  /** Moves time forward to the next timer and runs it, letting promises run as it fires. */
  next(): Promise<void>;
  /** Runs every timer that is waiting, including those the timers start, until none is left. */
  runAll(): void;
  /** Runs every timer that is waiting, including those the timers start, letting promises run. */
  runAllAsync(): Promise<void>;
  /** Runs only the timers that are waiting now, not those they start. */
  runPending(): void;
  /** How many timers are waiting. */
  pending(): number;
  /** Fakes only the named timers, for code that keeps the others real. */
  only(...names: FakedTimers): void;
}

/**
 * `test` with a clock that stands still until the test moves it: fake timers are on before the
 * test starts and the real ones are back when it ends.
 *
 * - `clock` is the {@link TimeControls}. Fixtures that need the clock for their own setup name it.
 */
export const test = base.extend<{ clock: TimeControls }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async clock({}, use) {
    vi.useFakeTimers();
    await use({
      advance: (ms) => {
        vi.advanceTimersByTime(ms);
      },
      advanceAsync: async (ms) => {
        await vi.advanceTimersByTimeAsync(ms);
      },
      next: async () => {
        await vi.advanceTimersToNextTimerAsync();
      },
      runAll: () => {
        vi.runAllTimers();
      },
      runAllAsync: async () => {
        await vi.runAllTimersAsync();
      },
      runPending: () => {
        vi.runOnlyPendingTimers();
      },
      pending: () => {
        return vi.getTimerCount();
      },
      only: (...names) => {
        vi.useFakeTimers({ toFake: names });
      },
    });
    vi.useRealTimers();
  },
});
