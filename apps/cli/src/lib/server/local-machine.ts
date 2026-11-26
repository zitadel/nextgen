import { realpath } from "@/lib/fs";
import { resolve } from "node:path";

import type { Run, TcpListener } from "./local";
import { LocalRuntime } from "./zitadel-runtime";
import { TcpPorts, listenersForPort, loopbackReach, systemRun, workingDirectories } from "./local";

/**
 * Who holds the port an app is to run on.
 *
 * - `none`: nothing does.
 * - `app`: every process listening on it runs in the app's folder, as the app's own dev server does.
 * - `other`: something else does. `listeners` names the processes this machine could see that do
 *   not run in the app's folder, and is empty when it could see none (no `lsof`, or another user's
 *   process).
 */
export type PortHolder =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "app" }>
  | Readonly<{ kind: "other"; listeners: readonly TcpListener[] }>;

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

  /**
   * Who holds `port`, for the app in `directory`: a process that runs in that folder is the app's
   * own dev server, so the port is the app's already.
   */
  portHolder(port: number, directory: string): Promise<PortHolder>;

  /** The server release this CLI ships, or `undefined` when it cannot be read. */
  bundledVersion(): string | undefined;

  /** The processes listening on a TCP port of this machine, for naming what holds one. */
  listeners(port: number, options?: { timeoutMs?: number }): Promise<readonly TcpListener[]>;

  /**
   * Whether the server at `serverUrl` can reach this machine's `localhost`:
   * `allowed` for a server the CLI started as a process with that opened,
   * `container` for one in Docker, where `localhost` is the container's own,
   * and `unknown` for any other server.
   */
  loopbackReach(cwd: string, serverUrl: string): Promise<"allowed" | "container" | "unknown">;
}

/** This machine, answering from its sockets, its records and the CLI's own install. */
export class RealMachine implements LocalMachine {
  private readonly ports: Pick<TcpPorts, "isFree">;
  private readonly run: Run;

  /**
   * @param ports - How to tell whether a port is held; the machine's own sockets by default.
   * @param run - How `lsof` is run to name a port's holders; this machine's own by default.
   */
  constructor(ports: Pick<TcpPorts, "isFree"> = new TcpPorts(), run: Run = systemRun) {
    this.ports = ports;
    this.run = run;
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

  /**
   * @remarks
   * Whether the port is held is the sockets' answer; `lsof` only names who holds it, so a holder it
   * cannot see is never taken for the app. Both folders are compared resolved, as `lsof` reports
   * one (`/private/tmp` on macOS for `/tmp`).
   */
  async portHolder(port: number, directory: string): Promise<PortHolder> {
    if (await this.isPortFree(port)) {
      return { kind: "none" };
    }
    const listeners = await this.listeners(port);
    const folders = await workingDirectories(
      [
        ...new Set(
          listeners.flatMap((listener) => {
            return listener.pid === undefined ? [] : [listener.pid];
          }),
        ),
      ],
      { run: this.run },
    );
    const app = await resolved(directory);
    const outside = (
      await Promise.all(
        listeners.map(async (listener) => {
          const folder = listener.pid === undefined ? undefined : folders.get(listener.pid);
          return folder !== undefined && (await resolved(folder)) === app ? [] : [listener];
        }),
      )
    ).flat();
    return listeners.length > 0 && outside.length === 0
      ? { kind: "app" }
      : { kind: "other", listeners: outside };
  }

  bundledVersion(): string | undefined {
    return LocalRuntime.bundledVersion();
  }

  loopbackReach(cwd: string, serverUrl: string): Promise<"allowed" | "container" | "unknown"> {
    return loopbackReach(cwd, serverUrl);
  }

  listeners(port: number, options?: { timeoutMs?: number }): Promise<readonly TcpListener[]> {
    return listenersForPort(port, { ...options, run: this.run });
  }
}

/**
 * A folder with its symbolic links resolved, or as given when it cannot be read.
 *
 * @param folder - The folder.
 * @returns Its real path.
 */
async function resolved(folder: string): Promise<string> {
  try {
    return await realpath(folder);
  } catch {
    return resolve(folder);
  }
}
