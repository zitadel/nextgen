import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { TcpPorts } from "../../../../../src/lib/local-server/internal/probes";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function listenOn(host: string | undefined): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("TcpPorts", () => {
  it("reports a port nothing holds as free", async () => {
    const port = await listenOn("127.0.0.1");
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));

    await expect(new TcpPorts().isFree(port)).resolves.toBe(true);
  });

  it("reports a port held on all interfaces as taken", async () => {
    const port = await listenOn(undefined);

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });

  it("reports a port held on the loopback address alone as taken", async () => {
    const port = await listenOn("127.0.0.1");

    await expect(new TcpPorts().isFree(port)).resolves.toBe(false);
  });
});
