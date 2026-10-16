import type { Clock } from "../../src/lib/local-server/internal/clock";

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
