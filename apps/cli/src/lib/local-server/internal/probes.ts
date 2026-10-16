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
 * one, and an empty one reads as a free port, which is how a start once decided
 * a taken port was free and then accepted another directory's server as its own.
 *
 * Whether a port is free and whether it is *claimed* are separate questions:
 * `isFree` looks at the machine, {@link TcpPorts.reserve} coordinates starts.
 */
export class TcpPorts implements PortProbe {
  private readonly claimsDir: string;
  private readonly network: Network;

  /**
   * `claimsDir` is where claims are kept; every `zitadel` on the machine must use
   * the same one. `network` is how the machine is asked about a port, and is only
   * replaced in tests, so the logic that combines the answers can be tested
   * without depending on which ports happen to be in use.
   */
  constructor(
    claimsDir: string = join(tmpdir(), "zitadel-local-ports"),
    network: Network = realNetwork,
  ) {
    this.claimsDir = claimsDir;
    this.network = network;
  }

  /**
   * Starts that choose a port at the same moment cannot tell it is taken until
   * one of them binds it, and a server takes seconds to bind: the loser used to
   * start, see the winner's server answer on its port, and report itself ready.
   * So a start claims the port first, with a file every `zitadel` on the machine
   * sees, and keeps the claim until its server answers. A claim whose owner is
   * gone is taken over.
   */
  reserve(port: number): Promise<(() => Promise<void>) | undefined> {
    return tryLock(join(this.claimsDir, String(port)));
  }

  /** Whether nothing holds the port. Says nothing about another start that has claimed it: see {@link reserve}. */
  async isFree(port: number): Promise<boolean> {
    if (await this.network.answers(port)) {
      return false;
    }
    return this.network.canBind(port);
  }
}

/** What the machine can be asked about a port. */
export interface Network {
  /** Whether something accepts a connection on the port, on either loopback address. */
  answers(port: number): Promise<boolean>;
  /** Whether the port can be bound on every interface. */
  canBind(port: number): Promise<boolean>;
}

/** The real thing: sockets. */
const realNetwork: Network = {
  answers(port) {
    const hosts = ["127.0.0.1", "::1"];
    return Promise.all(hosts.map((host) => connects(host, port))).then((results) =>
      results.some(Boolean),
    );
  },
  canBind(port) {
    return new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen({ port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
  },
};

/** Whether something accepts a connection on the port. A refusal, an error or silence is "no". */
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

/**
 * Asks the server's own health endpoint. It only says that *a* Zitadel answers
 * at the URL; which one is the launcher's identity check's job.
 */
export class HttpHealth implements HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean> {
    return checkLocalServerHealth(serverUrl, 1000);
  }
}
