import type { DockerResult, TcpListener, WritablePathProbe } from "./local";
import { LocalRuntime } from "./zitadel-runtime";
import { TcpPorts } from "./local";

/**
 * What the machine the CLI runs on can tell setup about local servers: whether
 * a port is taken, which port to suggest instead, which server a directory has
 * running, and which server release this CLI ships.
 */
export interface LocalMachine {
  /** The address of the server running for `cwd`, or `undefined` when none is. */
  detectUrl(cwd: string): Promise<string | undefined>;

  /** Whether nothing on this machine holds `port`. */
  isPortFree(port: number): Promise<boolean>;

  /** The first free port after `port`, or `undefined` when the next twenty are taken. */
  nextFreePort(port: number): Promise<number | undefined>;

  /** The server release this CLI ships, or `undefined` when it cannot be read. */
  bundledVersion(): string | undefined;

  /**
   * Whether the server at `serverUrl` can reach this machine's `localhost`:
   * `allowed` for a server the CLI started as a process with that opened,
   * `container` for one in Docker, where `localhost` is the container's own,
   * and `unknown` for any other server.
   */
  loopbackReach(cwd: string, serverUrl: string): Promise<"allowed" | "container" | "unknown">;
}

/**
 * What `doctor` asks of this machine: whether the install, Docker, the state
 * directories and the ports are in a state a local server can start in.
 */
export interface MachineChecks {
  /** The server release the install ships. @throws When the install is broken. */
  binaryVersion(): string;

  /** Whether `dir`, or the closest directory above it that exists, can be written. */
  canWrite(dir: string): Promise<WritablePathProbe>;

  /** What the Docker daemon answers. */
  docker(): Promise<DockerResult>;

  /** Where `image` can be had from: this machine or a registry. */
  imageSource(image: string): Promise<"local" | "remote">;

  /** Whether the server at `serverUrl` answers its readiness probe. */
  isHealthy(serverUrl: string): Promise<boolean>;

  /** The processes listening on a TCP port of this machine. */
  listeners(port: number, options?: { timeoutMs?: number }): Promise<readonly TcpListener[]>;
}

/** This machine, answering from its sockets, its records and the CLI's own install. */
export class SystemMachine implements LocalMachine, MachineChecks {
  private readonly ports: Pick<TcpPorts, "isFree">;

  /**
   * @param ports - How to tell whether a port is held; the machine's own sockets by default.
   */
  constructor(ports: Pick<TcpPorts, "isFree"> = new TcpPorts()) {
    this.ports = ports;
  }

  detectUrl(cwd: string): Promise<string | undefined> {
    return LocalRuntime.detectUrl(cwd);
  }

  isPortFree(port: number): Promise<boolean> {
    return this.ports.isFree(port);
  }

  async nextFreePort(port: number): Promise<number | undefined> {
    const count = Math.max(0, Math.min(port + 20, 65_535) - port);
    for (const next of Array.from({ length: count }, (_, index) => {
      return port + 1 + index;
    })) {
      if (await this.isPortFree(next)) {
        return next;
      }
    }
    return undefined;
  }

  bundledVersion(): string | undefined {
    return LocalRuntime.bundledVersion();
  }

  loopbackReach(cwd: string, serverUrl: string): Promise<"allowed" | "container" | "unknown"> {
    return LocalRuntime.loopbackReach(cwd, serverUrl);
  }

  binaryVersion(): string {
    return LocalRuntime.assertBinaryAvailable();
  }

  canWrite(dir: string): Promise<WritablePathProbe> {
    return LocalRuntime.assertWritable(dir);
  }

  docker(): Promise<DockerResult> {
    return LocalRuntime.dockerReachable();
  }

  imageSource(image: string): Promise<"local" | "remote"> {
    return LocalRuntime.imageAvailable(image);
  }

  isHealthy(serverUrl: string): Promise<boolean> {
    return LocalRuntime.isHealthy(serverUrl);
  }

  listeners(port: number, options?: { timeoutMs?: number }): Promise<readonly TcpListener[]> {
    return LocalRuntime.listenersOn(port, options);
  }
}
