import { setTimeout as sleep } from "node:timers/promises";

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

export const realClock: Clock = {
  now: () => Date.now(),
  wait: async (ms, signal) => {
    try {
      await sleep(ms, undefined, { signal });
    } catch (error) {
      if (!signal?.aborted) {
        throw error;
      }
    }
  },
};

/**
 * A signal that aborts when the CLI is interrupted (Ctrl-C) or asked to stop,
 * for what runs until then, such as following a log. `dispose` stops
 * listening.
 */
export function stopSignal(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    },
  };
}
