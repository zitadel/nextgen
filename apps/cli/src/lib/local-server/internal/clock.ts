import { setTimeout as sleep } from "node:timers/promises";

/**
 * Time, as the code that waits for something sees it. Waiting for a server to
 * answer, or for another start to finish, polls; taking the clock as a
 * dependency lets a test move time by hand instead of waiting for it.
 */
export interface Clock {
  now(): number;
  wait(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  wait: (ms) => sleep(ms),
};
