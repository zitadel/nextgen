/**
 * Runs `boot`, and runs it again with a fresh port when the server could not take
 * the one it was given. The testing kit asks the OS for a free port and releases
 * it before the server starts, so with many servers booting at once another
 * process can take it first; the next try asks again.
 */
export async function untilPortFree<T>(boot: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await boot();
    } catch (error) {
      const taken = error instanceof Error && error.message.includes("E_PORT_IN_USE");
      if (!taken || attempt >= attempts) {
        throw error;
      }
    }
  }
}
