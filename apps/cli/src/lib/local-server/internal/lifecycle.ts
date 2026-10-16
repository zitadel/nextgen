import { DEFAULT_LOCAL_SERVER_PORT } from "../runtime";
import { type Clock, realClock } from "./clock";

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
  /**
   * Whether what a record names still exists, answering or not. A `fresh` record
   * is one `launch` has just returned, which needs no check that it is still the
   * same server: there is nothing older it could have been confused with.
   */
  isAlive(record: R, options?: { fresh?: boolean }): Promise<boolean>;
  /** Stops it, `stale` when there was nothing left to stop. */
  terminate(record: R): Promise<StopOutcome>;
  /** The end of its own log, for explaining a failed start; read before it is cleaned up. */
  logTail?(record: R, lines: number): Promise<string | undefined>;
}

export interface PortProbe {
  isFree(port: number): Promise<boolean>;
  /**
   * Claims a port for one start until the returned function releases it, so that
   * two starts that choose at the same moment cannot choose the same port.
   * `undefined` when another start already has it.
   */
  reserve(port: number): Promise<(() => Promise<void>) | undefined>;
}

export interface HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean>;
}

export type ServerState<R extends ServerRecord> =
  | { kind: "stopped" }
  | { kind: "running"; record: R }
  | { kind: "dead"; record: R };

export type LifecycleOptions<R extends ServerRecord> = Readonly<{
  /** The port to use. Absent, the folder keeps the port it had, or takes the first free one. */
  port?: number;
  /** The port a folder without a record tries first. */
  firstPort?: number;
  /** The port the folder's server had under another backend, which it keeps when it can. */
  previousPort?: number;
  /** A running server is kept only when this holds; otherwise it is restarted. */
  reusable?: (record: R) => boolean;
  /** How long to wait for the new server to answer. */
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  clock?: Clock;
}>;

export type LifecycleDeps<R extends ServerRecord> = Readonly<{
  store: ServerStore<R>;
  launcher: Launcher<R>;
  ports: PortProbe;
  health: HealthProbe;
}>;

const PORT_SEARCH_RANGE = 100;
const PORT_RACE_RETRIES = 3;

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
  readonly logTail: string | undefined;

  constructor(reason: "exited" | "timeout", record: R, cleanup: StopOutcome, logTail?: string) {
    super(
      reason === "exited"
        ? "The server exited before it became healthy"
        : "The server did not become healthy in time",
    );
    this.reason = reason;
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
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
export class Lifecycle<R extends ServerRecord> {
  private readonly deps: LifecycleDeps<R>;
  private readonly options: LifecycleOptions<R>;

  constructor(deps: LifecycleDeps<R>, options: LifecycleOptions<R> = {}) {
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
    // A port that was asked for is taken as asked, or refused: moving to another
    // one would start a server where the caller did not look for it. A port
    // other than the running server's own is checked before that server is
    // touched, so a refused move leaves it running.
    if (requested !== undefined && requested !== previous?.port) {
      await this.assertFree(requested);
    }
    if (previous) {
      await this.terminate(previous);
    }
    let preferred = previous?.port ?? this.options.previousPort;
    for (let attempt = 0; ; attempt++) {
      const claim = await claimFreePort(
        this.deps.ports,
        requested,
        preferred,
        this.options.firstPort,
      );
      try {
        const record = await this.launchAndWait(claim.port);
        await this.deps.store.write(record);
        return { record, alreadyRunning: false };
      } catch (error) {
        // Someone else took the port between choosing it and binding it. The
        // choice was automatic, so the next port is tried. A server that failed
        // with its port still free crashed, and says so.
        if (
          requested === undefined &&
          attempt < PORT_RACE_RETRIES &&
          (error instanceof ServerStartError ? error.reason === "exited" : true) &&
          !(await this.deps.ports.isFree(claim.port))
        ) {
          preferred = claim.port + 1;
          continue;
        }
        throw error;
      } finally {
        await claim.release();
      }
    }
  }

  private async launchAndWait(port: number): Promise<R> {
    const record = await this.deps.launcher.launch({ port, serverUrl: serverUrlFor(port) });
    await this.waitUntilReady(record);
    return record;
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

  private async assertFree(port: number): Promise<void> {
    if (!(await this.deps.ports.isFree(port))) {
      throw new PortInUseError(port);
    }
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
    const clock = this.options.clock ?? realClock;
    const started = clock.now();
    while (clock.now() - started < timeout) {
      if (!(await this.deps.launcher.isAlive(record, { fresh: true }))) {
        throw await this.startFailure("exited", record);
      }
      if (await this.deps.health.isHealthy(record.server_url)) {
        if (!(await this.deps.launcher.isAlive(record, { fresh: true }))) {
          throw await this.startFailure("exited", record);
        }
        return;
      }
      await clock.wait(interval);
    }
    throw await this.startFailure("timeout", record);
  }

  private async startFailure(
    reason: "exited" | "timeout",
    record: R,
  ): Promise<ServerStartError<R>> {
    // The log goes first: cleaning up may remove it with the server.
    const logTail = await this.deps.launcher.logTail?.(record, 40).catch(() => undefined);
    return new ServerStartError(
      reason,
      record,
      await this.deps.launcher.terminate(record),
      logTail,
    );
  }
}

export type PortClaim = Readonly<{ port: number; release: () => Promise<void> }>;

/**
 * Claims the port a start will use. A port that was asked for is taken as asked
 * or refused. Otherwise the folder's own port, when it is free, so that URLs
 * written into the app's configuration stay valid across restarts, and else the
 * first free port above it: a port someone else holds is skipped, never shared.
 */
export async function claimFreePort(
  ports: PortProbe,
  requested?: number,
  preferred?: number,
  firstPort: number = DEFAULT_LOCAL_SERVER_PORT,
): Promise<PortClaim> {
  if (requested !== undefined) {
    const release = (await ports.isFree(requested)) ? await ports.reserve(requested) : undefined;
    if (!release) {
      throw new PortInUseError(requested);
    }
    return { port: requested, release };
  }
  const first = preferred ?? firstPort;
  for (let port = first; port < first + PORT_SEARCH_RANGE; port++) {
    if (await ports.isFree(port)) {
      const release = await ports.reserve(port);
      if (release) {
        return { port, release };
      }
    }
  }
  throw new NoFreePortError(first);
}

export function serverUrlFor(port: number): string {
  return `http://localhost:${String(port)}`;
}
