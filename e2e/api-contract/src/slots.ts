/**
 * Lets only so many pieces of work run at once; the rest wait their turn, in the
 * order they asked. A piece that finishes, however it ends, hands its place on.
 */
export class Slots {
  private readonly limit: number;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        // The place passes straight to the next in line, so the count stays put.
        next();
      } else {
        this.running -= 1;
      }
    }
  }
}
