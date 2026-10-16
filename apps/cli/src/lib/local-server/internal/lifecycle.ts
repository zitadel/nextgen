/**
 * The lifecycle of one directory's server, written against interfaces so it
 * can be tested with no processes, sockets, files or real time.
 *
 * This is the layer below `LocalServer` (the public class) and above the
 * launchers (`BinaryLauncher`, `DockerLauncher`). It decides what to do (reuse
 * the running server, restart it, which port to take, when a start has failed);
 * the launchers know how to run and stop a server; the probes and the store
 * know about the machine. Keep it that way: if this file starts to know how a
 * process is spawned or how a port is probed, the tests that make it cheap to
 * change stop being able to cover it.
 */
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

/**
 * Where a directory keeps its record of the server it started (in practice
 * `.zitadel/local/runtime.json`). The record is what ties a directory to its own
 * server, so everything that must not reach another directory's server starts
 * from it.
 */
export interface ServerStore<R extends ServerRecord> {
  read(): Promise<R | undefined>;
  write(record: R): Promise<void>;
}

/**
 * What stopping did. `stale` means there was nothing left to stop (the process
 * was already gone, or its pid had become another program and was left alone);
 * it is not a failure, so stopping twice is safe. `failed` means it was still
 * running after being signalled.
 */
export type StopOutcome = Readonly<{
  pid?: number;
  status: "failed" | "stale" | "stopped";
  target?: "process" | "process-group";
  signal?: NodeJS.Signals;
}>;

declare const launchedBrand: unique symbol;

/**
 * A record that `launch` has just returned, as opposed to one read back from
 * disk. The two are asked different questions about whether they are alive (see
 * {@link Launcher.isAlive} and {@link Launcher.isLaunchedAlive}), and the type
 * keeps them apart: only a launcher can make one, so a recorded server can never
 * be passed where a just-launched one is expected.
 */
export type Launched<R extends ServerRecord> = R & { readonly [launchedBrand]: true };

/** Marks a record as just launched. Only launchers call this, from `launch`. */
export function launched<R extends ServerRecord>(record: R): Launched<R> {
  return record as Launched<R>;
}

/**
 * Runs the server. The binary and Docker runtimes are two implementations; the
 * lifecycle treats a record as opaque beyond its port and URL, so a new way of
 * running a server needs a launcher and a record type, not changes here.
 */
export interface Launcher<R extends ServerRecord> {
  /** Starts a server on the port and returns the record that identifies it. It need not be ready. */
  launch(spec: { port: number; serverUrl: string }): Promise<Launched<R>>;
  /**
   * Whether the server a record read back from disk names still exists,
   * answering or not. This must check identity, not just existence: pids are
   * reused, and after a reboot the recorded one can be any program.
   */
  isAlive(record: R): Promise<boolean>;
  /**
   * Whether a server that `launch` has just returned still exists. It does not
   * check identity, on purpose: there is nothing older it could be confused
   * with, and on Linux the process list still shows a just-spawned process under
   * its parent's name until it has exec'd, so asking would wrongly say "not ours"
   * (this took down every journey lane once).
   */
  isLaunchedAlive(server: Launched<R>): Promise<boolean>;
  /**
   * What identifies the server in an error about it (its pid and log file, or its
   * container). The launcher owns this because only it knows what a record holds,
   * which keeps the error mapping from needing to know the backends.
   */
  describe(record: R): Readonly<Record<string, unknown>>;
  /** Stops it, `stale` when there was nothing left to stop. */
  terminate(record: R): Promise<StopOutcome>;
  /** The end of its own log, for explaining a failed start; read before it is cleaned up. */
  logTail?(record: R, lines: number): Promise<string | undefined>;
}

/**
 * What is known about ports. `isFree` says whether the port can be used right
 * now; `reserve` is what keeps two starts from choosing the same free port.
 */
export interface PortProbe {
  /** Whether nothing holds the port: it can neither be connected to nor bound. */
  isFree(port: number): Promise<boolean>;
  /**
   * Claims a port for one start until the returned function releases it, so that
   * two starts that choose at the same moment cannot choose the same port.
   * `undefined` when another start already has it.
   */
  reserve(port: number): Promise<(() => Promise<void>) | undefined>;
}

/**
 * Whether something answers as a healthy Zitadel at a URL. It cannot tell whose
 * server it is, which is why a launcher's identity check always comes with it.
 */
export interface HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean>;
}

/**
 * `stopped`: no record. `running`: the recorded server is alive and answering.
 * `dead`: a record whose server is gone, or alive but not answering; either way
 * the next start clears it.
 */
export type ServerState<R extends ServerRecord> =
  | { kind: "stopped" }
  | { kind: "running"; record: R }
  | { kind: "dead"; record: R };

export type LifecycleOptions<R extends ServerRecord> = Readonly<{
  /**
   * A port that was asked for. It is taken as asked or refused, never replaced:
   * a server somewhere the caller did not look for it is worse than an error.
   * Absent, the directory keeps the port it had, or takes the first free one.
   */
  port?: number;
  /** The port a directory without a record tries first (8080 by default). */
  firstPort?: number;
  /**
   * The port the directory's server had under the other backend. A backend
   * switch keeps it when it can, because the app's configuration names it.
   */
  previousPort?: number;
  /** A running server is kept only when this holds (right version, right image); otherwise it is restarted. */
  reusable?: (record: R) => boolean;
  /** How long to wait for a new server to answer before giving up on it. */
  startTimeoutMs?: number;
  /** How often to ask whether it answers. Waiting for a server has no event to wait on, so it polls. */
  pollIntervalMs?: number;
  /** Time. Tests pass one they move by hand, so none of them waits in real time. */
  clock?: Clock;
}>;

export type LifecycleDeps<R extends ServerRecord> = Readonly<{
  store: ServerStore<R>;
  launcher: Launcher<R>;
  ports: PortProbe;
  health: HealthProbe;
}>;

/** How many ports above the first are tried before giving up. */
const PORT_SEARCH_RANGE = 100;
/** How many times a start that lost a race for its port tries the next one. */
const PORT_RACE_RETRIES = 3;

/** Every port in the search range was taken. */
export class NoFreePortError extends Error {
  readonly firstPort: number;

  constructor(firstPort: number) {
    super(`No free port from ${String(firstPort)} to ${String(firstPort + PORT_SEARCH_RANGE - 1)}`);
    this.firstPort = firstPort;
  }
}

/** A port that was explicitly asked for is held, so the start is refused rather than moved. */
export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${String(port)} is already in use`);
    this.port = port;
  }
}

/**
 * A server was launched but did not become ready. `cleanup` says what stopping
 * it did, `logTail` is what it logged: the lifecycle reads the log before
 * cleaning up because cleaning up a container removes its log, which is the
 * only explanation of why it failed.
 */
export class ServerStartError<R extends ServerRecord> extends Error {
  readonly reason: "exited" | "timeout";
  readonly record: R;
  readonly cleanup: StopOutcome;
  readonly logTail: string | undefined;
  /** What identifies the server, from {@link Launcher.describe}. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    reason: "exited" | "timeout",
    record: R,
    cleanup: StopOutcome,
    details: Readonly<Record<string, unknown>>,
    logTail?: string,
  ) {
    super(
      reason === "exited"
        ? "The server exited before it became healthy"
        : "The server did not become healthy in time",
    );
    this.reason = reason;
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
    this.details = details;
  }
}

/** A server that had to be stopped (to restart or move it) was still running afterwards. */
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
 * One server for one directory: it starts, reports on and stops the server whose
 * record the directory's store holds. Everything it touches arrives through its
 * dependencies, so the lifecycle is testable without processes or sockets.
 *
 * It does not lock. Two starts in one directory are serialised by the caller
 * (see `withStartLock`), because only the caller knows what "one directory" is.
 */
export class Lifecycle<R extends ServerRecord> {
  private readonly deps: LifecycleDeps<R>;
  private readonly options: LifecycleOptions<R>;

  constructor(deps: LifecycleDeps<R>, options: LifecycleOptions<R> = {}) {
    this.deps = deps;
    this.options = options;
  }

  /**
   * `running` needs both a live server (by identity, not by pid alone) and a
   * healthy answer at its URL. A healthy answer by itself proves nothing: after
   * a directory's server stops, another directory's can take its port.
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

  /**
   * Makes sure the directory has a running server and returns its record.
   *
   * If the recorded server is running and acceptable (`reusable`, and on the
   * requested port if one was), it is kept. Otherwise whatever is recorded is
   * stopped, a port is claimed, and a new server is launched and waited for.
   * The record is written only once the server answers, so a failed start never
   * leaves a record that looks like a running server.
   */
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
    // A port other than the running server's own is checked before that server
    // is touched, so a refused move leaves it running. Its own port cannot be
    // checked yet: it is held by the server about to be stopped.
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
        let record: Launched<R>;
        try {
          record = await this.launchAndWait(claim.port);
        } catch (error) {
          // Someone else took the port between claiming it and binding it (a
          // process outside our claims, or a Docker publish that failed). The
          // choice was automatic, so the next port is tried. A server that failed
          // with its port still free crashed, and says so instead of being retried.
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
        }
        await this.save(record);
        return { record, alreadyRunning: false };
      } finally {
        await claim.release();
      }
    }
  }

  /**
   * Records a server that is ready. If the record cannot be written, the server
   * is stopped rather than left running unrecorded, where nothing could stop it
   * and the next start would run a second one over its data. This is outside the
   * port retry above on purpose: the server itself holds the port, so a retry
   * would launch another beside it.
   */
  private async save(record: Launched<R>): Promise<void> {
    try {
      await this.deps.store.write(record);
    } catch (error) {
      const outcome = await this.deps.launcher.terminate(record);
      if (outcome.status === "failed") {
        throw new ServerStopError(record, outcome);
      }
      throw error;
    }
  }

  /** Launches on the port and waits until it is ready; throws {@link ServerStartError} if it does not become so. */
  private async launchAndWait(port: number): Promise<Launched<R>> {
    const record = await this.deps.launcher.launch({ port, serverUrl: serverUrlFor(port) });
    await this.waitUntilReady(record);
    return record;
  }

  /**
   * Stops the recorded server. `not-running` when nothing was recorded or
   * nothing was left, which is not an error: stopping twice is safe. The record
   * stays, so the directory keeps its port for the next start.
   */
  async stop(): Promise<{ result: "stopped" | "not-running"; record?: R }> {
    const record = await this.deps.store.read();
    if (!record) {
      return { result: "not-running" };
    }
    const outcome = await this.terminate(record);
    return { result: outcome.status === "stopped" ? "stopped" : "not-running", record };
  }

  /** Refuses a port that is held. Used before anything is torn down, so a refusal changes nothing. */
  private async assertFree(port: number): Promise<void> {
    if (!(await this.deps.ports.isFree(port))) {
      throw new PortInUseError(port);
    }
  }

  /** Stops a server, and treats one that will not stop as an error, because starting over it would fight it for its port and data. */
  private async terminate(record: R): Promise<StopOutcome> {
    const outcome = await this.deps.launcher.terminate(record);
    if (outcome.status === "failed") {
      throw new ServerStopError(record, outcome);
    }
    return outcome;
  }

  /**
   * Ready means the server is alive and answering, and still alive once it has
   * answered. The second check is for a launch that lost a race for its port: it
   * dies right after failing to bind while the other server holding the port
   * keeps answering, so "something answered" is not "we are ready". Port claims
   * make this rare; this is the backstop.
   *
   * It polls, because a starting server gives no event to wait on; the clock is
   * injected so that tests do not wait in real time.
   */
  private async waitUntilReady(record: Launched<R>): Promise<void> {
    const timeout = this.options.startTimeoutMs ?? 90_000;
    const interval = this.options.pollIntervalMs ?? 1000;
    const clock = this.options.clock ?? realClock;
    const started = clock.now();
    while (clock.now() - started < timeout) {
      if (!(await this.deps.launcher.isLaunchedAlive(record))) {
        throw await this.startFailure("exited", record);
      }
      if (await this.deps.health.isHealthy(record.server_url)) {
        if (!(await this.deps.launcher.isLaunchedAlive(record))) {
          throw await this.startFailure("exited", record);
        }
        return;
      }
      await clock.wait(interval);
    }
    throw await this.startFailure("timeout", record);
  }

  /** Builds the failure for a server that did not become ready, reading its log before cleaning it up. */
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
      this.deps.launcher.describe(record),
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
  // A port is looked at again once it is claimed: another start may have bound
  // it and let go of its claim between the first look and this claim.
  if (requested !== undefined) {
    const release = await ports.reserve(requested);
    if (!release) {
      throw new PortInUseError(requested);
    }
    if (!(await ports.isFree(requested))) {
      await release();
      throw new PortInUseError(requested);
    }
    return { port: requested, release };
  }
  const first = preferred ?? firstPort;
  for (let port = first; port < first + PORT_SEARCH_RANGE; port++) {
    if (!(await ports.isFree(port))) {
      continue;
    }
    const release = await ports.reserve(port);
    if (!release) {
      continue;
    }
    if (await ports.isFree(port)) {
      return { port, release };
    }
    await release();
  }
  throw new NoFreePortError(first);
}

export function serverUrlFor(port: number): string {
  return `http://localhost:${String(port)}`;
}
