import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test as base } from "./clock";

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
  /** Takes over a process the code under test started, to be ended with the test. */
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

/**
 * Waits for a real moment to pass, whatever the test did to the clock.
 *
 * @param ms - How long.
 * @returns Once it has.
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    realTimeout(resolve, ms);
  });
}

/**
 * Whether a process, or a process group when the id is negative, can be signalled.
 *
 * @param target - The process id, or a group's id negated.
 * @returns Whether it exists.
 */
function exists(target: number): boolean {
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
function running(pid: number): boolean {
  return exists(-pid) || exists(pid);
}

/**
 * Sends a signal to the process and to the group it leads. A process that is gone is no error.
 *
 * @param pid - The process id.
 * @param signal - What to send.
 */
function send(pid: number, signal: NodeJS.Signals): void {
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
async function leaves(pid: number): Promise<boolean> {
  for (const _look of Array.from({ length: GRACE_MS / LOOK_AGAIN_MS }, (_, index) => index)) {
    if (!running(pid)) {
      return true;
    }
    await pause(LOOK_AGAIN_MS);
  }
  return !running(pid);
}

/**
 * Ends a process and its group: asks first, insists when it does not leave.
 *
 * @param pid - The process id.
 * @returns Once it is gone, or once it has been given its grace period after `SIGKILL`.
 */
async function end(pid: number): Promise<void> {
  if (!running(pid)) {
    return;
  }
  send(pid, "SIGTERM");
  if (await leaves(pid)) {
    return;
  }
  send(pid, "SIGKILL");
  await leaves(pid);
}

/**
 * Whether something accepts a TCP connection on a port.
 *
 * @param port - The port.
 * @param host - The host, loopback unless one is named.
 * @returns Whether a connection was accepted.
 */
function accepts(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
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
 * The process ids on the lines of a file; a file that is not there holds none.
 *
 * @param path - The file.
 * @returns The ids, in the order written.
 */
async function pidsIn(path: string): Promise<number[]> {
  const text = await readFile(path, "utf8").catch(() => {
    return "";
  });
  return text
    .split(/\r?\n/)
    .map((line) => {
      return Number.parseInt(line, 10);
    })
    .filter((pid) => {
      return Number.isInteger(pid) && pid > 0;
    });
}

/**
 * Starts a detached process and returns once it is ready.
 *
 * @param command - What to run.
 * @param args - Its arguments.
 * @param options - Where it runs, with what environment, and when it is ready.
 * @param started - Told of the process id as soon as there is one, so a process that never becomes
 *   ready is still ended with the test.
 * @returns The process.
 * @throws Error when it cannot be started or exits before it is ready.
 */
async function start(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  started: (pid: number) => void,
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
  const wrote = (): Promise<void> => {
    return new Promise((resolve) => {
      listeners.add(resolve);
    });
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
  started(pid);
  const failed = async (): Promise<Error> => {
    await end(pid);
    return new Error(`${command} exited before it was ready. It wrote:\n${output()}`);
  };
  const { ready } = options;
  if (ready instanceof RegExp) {
    while (!ready.test(output())) {
      if (state.closed) {
        throw await failed();
      }
      await Promise.race([wrote(), closed]);
    }
  } else if (ready !== undefined) {
    while (!(await accepts(ready.port, ready.host ?? "127.0.0.1"))) {
      if (state.closed) {
        throw await failed();
      }
      await Promise.race([closed, pause(LOOK_AGAIN_MS)]);
    }
  }
  return { pid, output, stop: () => end(pid) };
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
    const pids = new Set<number>();
    const logs: string[] = [];
    const home = await mkdtemp(join(tmpdir(), "daemon-"));
    await use({
      async spawn(command, args, options = {}) {
        return start(command, args, options, (pid) => {
          pids.add(pid);
        });
      },
      adopt(pid) {
        pids.add(pid);
      },
      pidLog() {
        const path = join(home, `pids-${String(logs.length)}.log`);
        logs.push(path);
        return path;
      },
    });
    for (const path of logs) {
      for (const pid of await pidsIn(path)) {
        pids.add(pid);
      }
    }
    await Promise.all(
      [...pids].map((pid) => {
        return end(pid);
      }),
    );
    await rm(home, { recursive: true, force: true });
  },
});
