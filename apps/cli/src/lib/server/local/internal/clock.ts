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
  now: () => {
    return Date.now();
  },
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
 * A signal that aborts when the run is interrupted (its Ctrl-C) or the CLI is
 * asked to stop, for what runs until then, such as following a log. `dispose`
 * stops listening.
 *
 * @param interrupted - The run's Ctrl-C, already aborted if it was pressed
 *   before this began, so a keypress before the follower started still stops it.
 * @returns The signal, and how to stop listening.
 */
export function stopSignal(interrupted: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  if (interrupted.aborted) {
    abort();
  } else {
    interrupted.addEventListener("abort", abort, { once: true });
  }
  process.once("SIGTERM", abort);
  return {
    signal: controller.signal,
    dispose: () => {
      interrupted.removeEventListener("abort", abort);
      process.off("SIGTERM", abort);
    },
  };
}
