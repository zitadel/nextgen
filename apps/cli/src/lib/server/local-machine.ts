import { LocalRuntime } from "./zitadel-runtime";

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
}

/** This machine, answering from its sockets, its records and the CLI's own install. */
export class SystemMachine implements LocalMachine {
  detectUrl(cwd: string): Promise<string | undefined> {
    return LocalRuntime.detectUrl(cwd);
  }

  isPortFree(port: number): Promise<boolean> {
    return LocalRuntime.isPortFree(port);
  }

  nextFreePort(port: number): Promise<number | undefined> {
    return LocalRuntime.nextFreePort(port);
  }

  bundledVersion(): string | undefined {
    return LocalRuntime.bundledVersion();
  }
}
