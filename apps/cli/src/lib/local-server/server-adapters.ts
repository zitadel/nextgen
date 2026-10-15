import { createConnection, createServer } from "node:net";

import {
  type RuntimeMetadata,
  checkLocalServerHealth,
  readRuntimeMetadata,
  writeRuntimeMetadata,
} from "./runtime";
import type { HealthProbe, PortProbe, ServerStore } from "./server";

/**
 * A port is free when it can be bound and nothing answers on it. Binding alone
 * misses a server bound to one loopback address, which a wildcard bind can sit
 * beside, and connecting alone misses a socket that listens but does not accept
 * yet. `lsof` is not used: a listing that fails or times out reads as an empty
 * one, and an empty one reads as a free port.
 */
export class TcpPorts implements PortProbe {
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

/**
 * The folder's `.zitadel/local/runtime.json`, seen as the record of one backend.
 * A record the other backend wrote reads as nothing here: that server is not
 * this launcher's to manage.
 */
export class RuntimeFileStore<R extends RuntimeMetadata> implements ServerStore<R> {
  private readonly cwd: string;
  private readonly backend: R["backend"];

  constructor(cwd: string, backend: R["backend"]) {
    this.cwd = cwd;
    this.backend = backend;
  }

  async read(): Promise<R | undefined> {
    const runtime = await readRuntimeMetadata(this.cwd);
    return runtime?.backend === this.backend ? (runtime as R) : undefined;
  }

  write(record: R): Promise<void> {
    return writeRuntimeMetadata(this.cwd, record);
  }
}
