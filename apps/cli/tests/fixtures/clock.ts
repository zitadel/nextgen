import { vi } from "vitest";

import type { Clock } from "@/lib/server/local/internal/clock";
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

/** Fake timers that stand still until the test moves them, and give the real ones back. */
class FakeTimers implements TimeControls {
  /** Installs fake timers for every timer Vitest can fake. */
  constructor() {
    vi.useFakeTimers();
  }

  advance(ms: number): void {
    vi.advanceTimersByTime(ms);
  }

  async advanceAsync(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  async next(): Promise<void> {
    await vi.advanceTimersToNextTimerAsync();
  }

  runAll(): void {
    vi.runAllTimers();
  }

  async runAllAsync(): Promise<void> {
    await vi.runAllTimersAsync();
  }

  runPending(): void {
    vi.runOnlyPendingTimers();
  }

  pending(): number {
    return vi.getTimerCount();
  }

  only(...names: FakedTimers): void {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: names });
  }

  /** Gives the real timers back. */
  dispose(): void {
    vi.useRealTimers();
  }
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
    const timers = new FakeTimers();
    await use(timers);
    timers.dispose();
  },
});
