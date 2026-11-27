/**
 * What a directory records about the server started in it, read once per run.
 *
 * A command that reports which server it was about needs that before the run's
 * context is built, so its first event names the right server, and again while
 * it works. Reading it twice would ask the filesystem twice for the same
 * answer, so each directory's first read is kept — keyed by directory, since
 * one asked about is not evidence about another.
 */
export class StartedServer<T> {
  private readonly read: (cwd: string) => Promise<T | undefined>;
  private readonly found = new Map<string, Promise<T | undefined>>();

  /**
   * @param read - Reads the record of a directory.
   */
  constructor(read: (cwd: string) => Promise<T | undefined>) {
    this.read = read;
  }

  /**
   * @param cwd - The directory asked about.
   * @returns What it records, read at most once while the read succeeds.
   */
  async of(cwd: string): Promise<T | undefined> {
    const already = this.found.get(cwd);
    if (already !== undefined) {
      return already;
    }
    // Only an answer is worth keeping: a read that failed may have failed on
    // a half-written file or a busy machine, and the next caller deserves
    // its own attempt rather than this one's failure.
    const reading = this.read(cwd);
    this.found.set(cwd, reading);
    try {
      return await reading;
    } catch (error) {
      this.found.delete(cwd);
      throw error;
    }
  }
}
