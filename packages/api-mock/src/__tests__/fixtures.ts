/**
 * Fixtures for the node specs of this package: a spec that names one in its first argument gets it,
 * and the teardown runs after the test whether it passed or not.
 *
 * - `server` is an MSW server listening for the test, one that fails a request nothing handled.
 *   Each test adds its own handlers with `server.use(...)`.
 * - `clock` moves `Date` for the test, and gives real time back when the test ends.
 */
import { setupServer } from "msw/node";
import { test as base, vi } from "vitest";

/** Moves `Date` without touching the timers. */
export interface Clock {
  /**
   * Fakes `Date` and sets it to a moment.
   *
   * @param time - The moment to set, as epoch milliseconds or a `Date`.
   */
  set(time: number | Date): void;
  /** Gives real time back before the test ends. */
  restore(): void;
}

export const test = base.extend<{
  server: ReturnType<typeof setupServer>;
  clock: Clock;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async server({}, use) {
    const server = setupServer();
    server.listen({ onUnhandledRequest: "error" });
    await use(server);
    server.resetHandlers();
    server.close();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async clock({}, use) {
    await use({
      set(time) {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(time);
      },
      restore() {
        vi.useRealTimers();
      },
    });
    vi.useRealTimers();
  },
});
