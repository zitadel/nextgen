import { createServer, type Server } from "node:net";

import { test } from "@tests/helpers/fixtures";

/**
 * Holds a TCP listener on a port the OS picks, for a test of what the CLI does when a port is
 * taken, and returns the port. The listener is closed when the test ends.
 */
export type OccupiedPort = (host?: string) => Promise<number>;

/**
 * `it` with a port someone else is holding.
 *
 * - `occupiedPort` listens on port 0, on every interface unless a host such as `"127.0.0.1"` is
 *   named, and returns the port. Every listener it started is closed when the test ends.
 */
export const it = test.extend<{ occupiedPort: OccupiedPort }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async occupiedPort({}, use) {
    const held: Server[] = [];
    await use(async (host) => {
      const server = createServer();
      held.push(server);
      await new Promise<void>((resolve) => {
        server.listen(0, host, () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("the listener did not expose a TCP address");
      }
      return address.port;
    });
    await Promise.all(
      held.map((server) => {
        return new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }),
    );
  },
});
