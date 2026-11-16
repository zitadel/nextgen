import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

import { test as base } from "./clock";
import { scratchDir } from "./scratch";

/**
 * When a spawned process counts as started: its output matches a pattern, or something accepts a
 * TCP connection on a port. Without one, it counts as started once the operating system has
 * created it.
 */
export type Ready = RegExp | { readonly port: number; readonly host?: string };

/** What a spawned process is started with. */
export interface SpawnOptions {
  /** The directory it runs in. */
  readonly cwd?: string;
  /** Its environment, whole: nothing is merged in from this process. */
  readonly env?: NodeJS.ProcessEnv;
  /** When the call returns. */
  readonly ready?: Ready;
}

/** A process the test started, in a process group of its own. */
export interface Daemon {
  /** Its process id, which is also the id of its group. */
  readonly pid: number;
  /** Everything it wrote to stdout and stderr so far, in the order it arrived. */
  output(): string;
  /**
   * Ends it and everything in its group: `SIGTERM`, then `SIGKILL` if it will not go. Returns once
   * it is gone; a process that already exited is nothing to do.
   */
  stop(): Promise<void>;
}

/** The processes a test starts or takes over, all ended when the test does. */
export interface Daemons {
  /**
   * Starts a process, detached into its own process group, and returns once it is ready.
   *
   * @throws Error when the process cannot be started or exits before it is ready, with what it
   *   wrote.
   */
  spawn(command: string, args: readonly string[], options?: SpawnOptions): Promise<Daemon>;
  /**
   * Takes over a process the code under test started, to be ended with the test.
   *
   * @throws Error when `pid` is not a positive integer, which would signal a group that is not the
   *   process's own.
   */
  adopt(pid: number): void;
  /**
   * A path, in a directory of the daemon's own, for a program to append the ids of the processes it
   * starts to, one on each line, such as a log of the helpers it started. When the test ends every
   * process named in it is ended. The directory outlives the test's own, so the log is still there
   * to be read.
   *
   * @returns The path of a new log, which holds no one until the program writes to it.
   */
  pidLog(): string;
}

/** How long a process gets to leave after `SIGTERM`, and again after `SIGKILL`, in milliseconds. */
const GRACE_MS = 3_000;

/** How often a process still leaving is looked at again, and a closed port tried again. */
const LOOK_AGAIN_MS = 20;

/**
 * The timer the module was loaded with, so a test that fakes the clock cannot stop a process
 * from being waited on.
 */
const realTimeout = globalThis.setTimeout;

/** The processes a test started or took over, and how to end them. */
class DaemonPool implements Daemons {
  private readonly pids = new Set<number>();
  private readonly logs: string[] = [];
  private readonly home: string;

  /**
   * @param home - A directory that outlives the test's own fixtures, for the pid logs.
   */
  constructor(home: string) {
    this.home = home;
  }

  async spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions = {},
  ): Promise<Daemon> {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: string[] = [];
    const listeners = new Set<() => void>();
    const state = { closed: false };
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => {
        state.closed = true;
        resolve();
      });
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        chunks.push(chunk);
        for (const listener of listeners) {
          listener();
        }
        listeners.clear();
      });
    }
    const output = (): string => {
      return chunks.join("");
    };
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => {
        if (child.pid === undefined) {
          reject(new Error(`${command} started without a pid`));
          return;
        }
        resolve(child.pid);
      });
    });
    this.pids.add(pid);
    void closed.then(() => {
      this.pids.delete(pid);
    });
    const failed = async (): Promise<Error> => {
      await DaemonPool.end(pid);
      return new Error(`${command} exited before it was ready. It wrote:\n${output()}`);
    };
    const { ready } = options;
    if (ready instanceof RegExp) {
      while (!ready.test(output())) {
        if (state.closed) {
          throw await failed();
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            listeners.add(resolve);
          }),
          closed,
        ]);
      }
    } else if (ready !== undefined) {
      const { port, host = "127.0.0.1" } = ready;
      while (!(await DaemonPool.accepts(port, host))) {
        if (state.closed) {
          throw await failed();
        }
        await Promise.race([closed, DaemonPool.pause(LOOK_AGAIN_MS)]);
      }
    }
    return {
      pid,
      output,
      stop: () => {
        return DaemonPool.end(pid);
      },
    };
  }

  adopt(pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`cannot adopt ${String(pid)}: it is not a process id`);
    }
    this.pids.add(pid);
  }

  pidLog(): string {
    const path = join(this.home, `pids-${String(this.logs.length)}.log`);
    this.logs.push(path);
    return path;
  }

  /**
   * Ends every process that was started, taken over, or named in a pid log.
   *
   * @returns Once all of them are gone.
   */
  async dispose(): Promise<void> {
    for (const path of this.logs) {
      const text = await readFile(path, "utf8").catch(() => {
        return "";
      });
      for (const line of text.split(/\r?\n/)) {
        const pid = Number.parseInt(line, 10);
        if (Number.isInteger(pid) && pid > 0) {
          this.pids.add(pid);
        }
      }
    }
    await Promise.all(
      [...this.pids].map((pid) => {
        return DaemonPool.end(pid);
      }),
    );
  }

  /**
   * Waits for a real moment to pass, whatever the test did to the clock.
   *
   * @param ms - How long.
   * @returns Once it has.
   */
  private static pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      realTimeout(resolve, ms);
    });
  }

  /**
   * Whether something accepts a TCP connection on the port.
   *
   * @param port - The port.
   * @param host - The host.
   * @returns Whether a connection was made.
   */
  private static accepts(port: number, host: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = connect({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Whether a process, or a process group when the id is negative, can be signalled.
   *
   * @param target - The process id, or a group's id negated.
   * @returns Whether it exists.
   */
  private static exists(target: number): boolean {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  }

  /**
   * Whether the process or anything in the group it leads is still there.
   *
   * @param pid - The process id.
   * @returns Whether any of it runs.
   */
  private static running(pid: number): boolean {
    return DaemonPool.exists(-pid) || DaemonPool.exists(pid);
  }

  /**
   * Sends a signal to the process and to the group it leads. A process that is gone is no error.
   *
   * @param pid - The process id.
   * @param signal - What to send.
   */
  private static send(pid: number, signal: NodeJS.Signals): void {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, signal);
      } catch {
        // Already gone, which is what was asked for.
      }
    }
  }

  /**
   * Waits for a process and its group to be gone.
   *
   * @param pid - The process id.
   * @returns Whether it left within the grace period.
   */
  private static async leaves(pid: number): Promise<boolean> {
    const deadline = Date.now() + GRACE_MS;
    while (DaemonPool.running(pid)) {
      if (Date.now() >= deadline) {
        return false;
      }
      await DaemonPool.pause(LOOK_AGAIN_MS);
    }
    return true;
  }

  /**
   * Ends a process and its group: asks first, insists when it does not leave.
   *
   * @param pid - The process id.
   * @returns Once it is gone, or once it has been given its grace period after `SIGKILL`.
   */
  private static async end(pid: number): Promise<void> {
    if (!DaemonPool.running(pid)) {
      return;
    }
    DaemonPool.send(pid, "SIGTERM");
    if (await DaemonPool.leaves(pid)) {
      return;
    }
    DaemonPool.send(pid, "SIGKILL");
    await DaemonPool.leaves(pid);
  }
}

/**
 * `test` with the processes a test starts, ended with it. It knows nothing of the CLI: it starts
 * what it is told to and ends what it is given.
 *
 * - `daemon` is the {@link Daemons}. When the test ends, every process it started or took over,
 *   and its whole process group, gets `SIGTERM`, then `SIGKILL` after a grace period. One that
 *   already exited is ignored.
 */
export const test = base.extend<{ daemon: Daemons }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async daemon({}, use) {
    const pool = new DaemonPool(await scratchDir("daemon-"));
    await use(pool);
    await pool.dispose();
  },
});
