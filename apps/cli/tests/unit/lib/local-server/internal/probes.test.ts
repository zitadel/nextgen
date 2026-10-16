import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { TcpPorts } from "../../../../../src/lib/local-server/internal/probes";
import { nextPort } from "../../../../helpers/ports";

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

describe("TcpPorts reservations", () => {
  const port = nextPort();

  it("gives a port to one start at a time", async () => {
    const ports = new TcpPorts();
    const release = await ports.reserve(port);

    await expect(new TcpPorts().reserve(port)).resolves.toBeUndefined();
    await release?.();
  });

  it("gives the port out again once it is released", async () => {
    const ports = new TcpPorts();
    const release = await ports.reserve(port);
    await release?.();

    const again = await ports.reserve(port);

    expect(again).toBeTypeOf("function");
    await again?.();
  });

  it("keeps different ports apart", async () => {
    const ports = new TcpPorts();
    const first = await ports.reserve(port);

    const second = await ports.reserve(port + 1);

    expect(second).toBeTypeOf("function");
    await first?.();
    await second?.();
  });
});

describe("TcpPorts", () => {
  it("reports a port nothing holds as free", async () => {
    await expect(new TcpPorts().isFree(nextPort())).resolves.toBe(true);
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
