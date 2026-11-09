import pTimeout from "p-timeout";

/**
 * Remembers the sends that are in the air, so a process can wait for them on
 * its way out.
 *
 * It keeps one promise that stands for every send added so far. Adding a send
 * folds it into that promise and does not wait for it, so sends run side by
 * side and the wait at the end is about as long as the slowest one.
 */
export class Outbox {
  private settled: Promise<unknown> = Promise.resolve();

  /** Remembers a send that has already started. */
  add(send: Promise<void>): void {
    this.settled = Promise.allSettled([this.settled, send]);
  }

  /** Resolves when every remembered send is over, or after `timeoutMs`, whichever comes first. */
  async drain(timeoutMs: number): Promise<void> {
    await pTimeout(this.settled, { milliseconds: timeoutMs, message: false });
  }
}
