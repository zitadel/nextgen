import { setTimeout as sleep } from "node:timers/promises";

/**
 * What the lifecycle needs to know about a running server, whatever started it.
 * Which process or container it is stays in the launcher's own record type.
 */
export type ServerRecord = Readonly<{
  port: number;
  server_url: string;
}>;

/** Where a folder keeps its record of the server it started. */
export interface ServerStore<R extends ServerRecord> {
  read(): Promise<R | undefined>;
  write(record: R): Promise<void>;
}

export type StopOutcome = Readonly<{
  pid?: number;
  status: "failed" | "stale" | "stopped";
  target?: "process" | "process-group";
  signal?: NodeJS.Signals;
}>;

/** Runs the server. The binary and Docker runtimes are two implementations. */
export interface Launcher<R extends ServerRecord> {
  launch(spec: { port: number; serverUrl: string }): Promise<R>;
  /** Whether what `launch` started still exists, answering or not. */
  isAlive(record: R): Promise<boolean>;
  /** Stops it, `stale` when there was nothing left to stop. */
  terminate(record: R): Promise<StopOutcome>;
}

export interface PortProbe {
  isFree(port: number): Promise<boolean>;
}

export interface HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean>;
}

export type ServerState<R extends ServerRecord> =
  | { kind: "stopped" }
  | { kind: "running"; record: R }
  | { kind: "dead"; record: R };

export type LocalServerOptions<R extends ServerRecord> = Readonly<{
  /** The port to use. Absent, the folder keeps the port it had, or takes the first free one. */
  port?: number;
  /** The port a folder without a record tries first. */
  firstPort?: number;
  /** A running server is kept only when this holds; otherwise it is restarted. */
  reusable?: (record: R) => boolean;
  /** How long to wait for the new server to answer. */
  startTimeoutMs?: number;
  pollIntervalMs?: number;
}>;

export type LocalServerDeps<R extends ServerRecord> = Readonly<{
  store: ServerStore<R>;
  launcher: Launcher<R>;
  ports: PortProbe;
  health: HealthProbe;
}>;

export const FIRST_LOCAL_SERVER_PORT = 8080;
const PORT_SEARCH_RANGE = 100;

export class NoFreePortError extends Error {
  readonly firstPort: number;

  constructor(firstPort: number) {
    super(`No free port from ${String(firstPort)} to ${String(firstPort + PORT_SEARCH_RANGE - 1)}`);
    this.firstPort = firstPort;
  }
}

export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${String(port)} is already in use`);
    this.port = port;
  }
}

export class ServerStartError<R extends ServerRecord> extends Error {
  readonly reason: "exited" | "timeout";
  readonly record: R;
  readonly cleanup: StopOutcome;

  constructor(reason: "exited" | "timeout", record: R, cleanup: StopOutcome) {
    super(
      reason === "exited"
        ? "The server exited before it became healthy"
        : "The server did not become healthy in time",
    );
    this.reason = reason;
    this.record = record;
    this.cleanup = cleanup;
  }
}

export class ServerStopError<R extends ServerRecord> extends Error {
  readonly record: R;
  readonly outcome: StopOutcome;

  constructor(record: R, outcome: StopOutcome) {
    super("The server did not stop");
    this.record = record;
    this.outcome = outcome;
  }
}

/**
 * One server for one folder: it starts, reports on and stops the server whose
 * record the folder's store holds. Everything it touches arrives through its
 * dependencies, so the lifecycle is testable without processes or sockets.
 */
export class LocalServer<R extends ServerRecord> {
  private readonly deps: LocalServerDeps<R>;
  private readonly options: LocalServerOptions<R>;

  constructor(deps: LocalServerDeps<R>, options: LocalServerOptions<R> = {}) {
    this.deps = deps;
    this.options = options;
  }

  /**
   * `running` needs both a live server and a healthy answer at its URL; a
   * recorded server that is gone, or one that does not answer, is `dead`.
   */
  async state(): Promise<ServerState<R>> {
    const record = await this.deps.store.read();
    if (!record) {
      return { kind: "stopped" };
    }
    const alive = await this.deps.launcher.isAlive(record);
    return alive && (await this.deps.health.isHealthy(record.server_url))
      ? { kind: "running", record }
      : { kind: "dead", record };
  }

  async start(): Promise<{ record: R; alreadyRunning: boolean }> {
    const state = await this.state();
    const requested = this.options.port;
    if (
      state.kind === "running" &&
      (requested === undefined || requested === state.record.port) &&
      (this.options.reusable?.(state.record) ?? true)
    ) {
      await this.deps.store.write(state.record);
      return { record: state.record, alreadyRunning: true };
    }

    const previous = state.kind === "stopped" ? undefined : state.record;
    if (previous) {
      await this.terminate(previous);
    }

    // A port that was asked for is taken as asked, or refused: moving to another
    // one would start a server where the caller did not look for it.
    if (requested !== undefined && !(await this.deps.ports.isFree(requested))) {
      throw new PortInUseError(requested);
    }
    const port = requested ?? (await this.choosePort(previous?.port));
    const record = await this.deps.launcher.launch({ port, serverUrl: serverUrlFor(port) });
    await this.waitUntilReady(record);
    await this.deps.store.write(record);
    return { record, alreadyRunning: false };
  }

  /** Stops the recorded server. `not-running` when nothing was recorded or nothing was left. */
  async stop(): Promise<{ result: "stopped" | "not-running"; record?: R }> {
    const record = await this.deps.store.read();
    if (!record) {
      return { result: "not-running" };
    }
    const outcome = await this.terminate(record);
    return { result: outcome.status === "stopped" ? "stopped" : "not-running", record };
  }

  /**
   * The folder's own port when it is free, so URLs written into the app's
   * configuration stay valid across restarts, and otherwise the first free port
   * above it. A port someone else holds is skipped, never shared.
   */
  choosePort(preferred?: number): Promise<number> {
    return chooseFreePort(this.deps.ports, preferred, this.options.firstPort);
  }

  private async terminate(record: R): Promise<StopOutcome> {
    const outcome = await this.deps.launcher.terminate(record);
    if (outcome.status === "failed") {
      throw new ServerStopError(record, outcome);
    }
    return outcome;
  }

  /**
   * Ready means the process is alive and answering, and still alive once it
   * has answered: a process that lost the race for its port dies right after
   * binding fails, while the server that holds the port keeps answering.
   */
  private async waitUntilReady(record: R): Promise<void> {
    const timeout = this.options.startTimeoutMs ?? 90_000;
    const interval = this.options.pollIntervalMs ?? 1000;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (!(await this.deps.launcher.isAlive(record))) {
        throw await this.startFailure("exited", record);
      }
      if (await this.deps.health.isHealthy(record.server_url)) {
        if (!(await this.deps.launcher.isAlive(record))) {
          throw await this.startFailure("exited", record);
        }
        return;
      }
      await sleep(interval);
    }
    throw await this.startFailure("timeout", record);
  }

  private async startFailure(
    reason: "exited" | "timeout",
    record: R,
  ): Promise<ServerStartError<R>> {
    return new ServerStartError(reason, record, await this.deps.launcher.terminate(record));
  }
}

/** `preferred` when free, else the first free port above it; `firstPort` (8080) when there is no preference. */
export async function chooseFreePort(
  ports: PortProbe,
  preferred?: number,
  firstPort: number = FIRST_LOCAL_SERVER_PORT,
): Promise<number> {
  const first = preferred ?? firstPort;
  for (let port = first; port < first + PORT_SEARCH_RANGE; port++) {
    if (await ports.isFree(port)) {
      return port;
    }
  }
  throw new NoFreePortError(first);
}

export function serverUrlFor(port: number): string {
  return `http://localhost:${String(port)}`;
}
