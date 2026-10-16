import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkLocalServerHealth } from "../runtime";
import type { HealthProbe, PortProbe } from "./lifecycle";
import { tryLock } from "./start-lock";

/**
 * A port is free when it can be bound and nothing answers on it. Binding alone
 * misses a server bound to one loopback address, which a wildcard bind can sit
 * beside, and connecting alone misses a socket that listens but does not accept
 * yet. `lsof` is not used: a listing that fails or times out reads as an empty
 * one, and an empty one reads as a free port.
 */
export class TcpPorts implements PortProbe {
  /**
   * Starts that choose a port at the same moment cannot tell it is taken until
   * one of them binds it, so a start claims the port first, with a file every
   * `zitadel` on the machine sees, and keeps the claim until its server answers.
   */
  reserve(port: number): Promise<(() => Promise<void>) | undefined> {
    return tryLock(join(tmpdir(), "zitadel-local-ports", String(port)));
  }

  async isFree(port: number): Promise<boolean> {
    if (await this.answers(port)) {
      return false;
    }
    return this.canBind(port);
  }

  private answers(port: number): Promise<boolean> {
    const hosts = ["127.0.0.1", "::1"];
    return Promise.all(hosts.map((host) => connects(host, port))).then((results) =>
      results.some(Boolean),
    );
  }

  private canBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen({ port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
  }
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export class HttpHealth implements HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean> {
    return checkLocalServerHealth(serverUrl, 1000);
  }
}
