/**
 * What a directory records about the server started in it.
 */

/**
 * Reads what a directory records about the server started in it, once per run.
 *
 * A command that reports which server it was about needs that before the run's
 * context is built, so its first event names the right server, and again while
 * it works. Reading it twice would ask the filesystem twice for the same
 * answer, so each directory's first read is kept — keyed by directory, since
 * one asked about is not evidence about another.
 */
export function startedServer<T>(read: (cwd: string) => Promise<T | undefined>) {
  const found = new Map<string, Promise<T | undefined>>();
  return {
    of: (cwd: string): Promise<T | undefined> => {
      const already = found.get(cwd);
      if (already !== undefined) {
        return already;
      }
      // Only an answer is worth keeping: a read that failed may have failed on
      // a half-written file or a busy machine, and the next caller deserves
      // its own attempt rather than this one's failure.
      const reading = read(cwd).catch((error: unknown) => {
        found.delete(cwd);
        throw error;
      });
      found.set(cwd, reading);
      return reading;
    },
  };
}
