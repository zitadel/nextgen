import { createServer } from "node:net";

/**
 * Ask the OS for a free TCP port. The port is released before returning, so a
 * racing process could grab it; the CLI's own preflight surfaces that as
 * E_PORT_IN_USE, which is loud rather than corrupting.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not determine a free port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}
