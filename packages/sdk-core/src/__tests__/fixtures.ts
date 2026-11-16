import type { AddressInfo, Server, Socket } from "node:net";

import { test as base } from "vitest";

/** Starts a server on a free loopback port and returns its base URL. */
export type Serve = (server: Server) => Promise<string>;

/**
 * `test` with the resources the specs of this package need: a spec that names one in its first
 * argument gets it, and the teardown runs after the test whether it passed or not.
 *
 * - `serve` listens the given server on a port the operating system picks, on the loopback address,
 *   and gives back its base URL. Every server it started is closed when the test ends, and any
 *   connection still open is destroyed first.
 */
export const test = base.extend<{ serve: Serve }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async serve({}, use) {
    const started: Server[] = [];
    const sockets: Socket[] = [];
    await use(async (server) => {
      started.push(server);
      server.on("connection", (socket) => {
        sockets.push(socket);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    for (const socket of sockets) {
      socket.destroy();
    }
    await Promise.all(
      started.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  },
});
