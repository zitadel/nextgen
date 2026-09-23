import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const TERM_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 2_000;

export type SupervisedSpec = {
  args: ReadonlyArray<string>;
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called for every chunk written to the child's stdout or stderr. */
  onOutput: (chunk: string) => void;
  /** Called when the child exits on its own, never after {@link SupervisedProcess.stop}. */
  onUnexpectedExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
};

/**
 * A child process the run loop owns: started, streamed, stopped, and started
 * again on demand.
 *
 * Started in its own process group (`detached`) so stopping it stops what it
 * spawned. A framework dev server is a supervisor of its own (`next dev` forks
 * a worker, a package manager sits between the CLI and the framework), and
 * signalling only the process this CLI spawned would leave the actual server
 * holding the port, which the next start then fails on.
 */
export class SupervisedProcess {
  private child?: ChildProcess;
  private exited?: Promise<void>;
  private stopping = false;

  constructor(private readonly spec: SupervisedSpec) {}

  get running(): boolean {
    return this.child !== undefined;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Spawns the child. Throws synchronously only on an invalid spec; a missing
   * binary surfaces through `onUnexpectedExit` like any other early exit. */
  start(): void {
    if (this.child) {
      return;
    }
    this.stopping = false;
    const child = spawn(this.spec.command, [...this.spec.args], {
      cwd: this.spec.cwd,
      env: this.spec.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.spec.onOutput(chunk));
    child.stderr?.on("data", (chunk: string) => this.spec.onOutput(chunk));
    // A spawn failure (no such binary) arrives as an error event rather than
    // output, so it is reported through the same channel the child's own
    // messages take, otherwise it would be silent.
    child.on("error", (error: Error) => {
      this.spec.onOutput(`${error.message}\n`);
    });
    this.exited = new Promise<void>((resolve) => {
      child.on("close", (code, signal) => {
        this.child = undefined;
        resolve();
        if (!this.stopping) {
          this.spec.onUnexpectedExit?.({ code, signal });
        }
      });
    });
  }

  /**
   * Stops the child and waits for it to go. `SIGTERM` to the group first so a
   * dev server can close its sockets, `SIGKILL` if it outstays the grace.
   * Resolves once the process is gone or was never running.
   */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid) {
      return;
    }
    this.stopping = true;
    const exited = this.exited ?? Promise.resolve();
    this.signal(child.pid, "SIGTERM");
    if (await settled(exited, TERM_TIMEOUT_MS)) {
      return;
    }
    this.signal(child.pid, "SIGKILL");
    await settled(exited, KILL_TIMEOUT_MS);
  }

  /**
   * Signals the child's process group where there is one, falling back to the
   * process itself: on Windows, and when the group is already gone but the
   * handle has not been reaped yet.
   */
  private signal(pid: number, signal: NodeJS.Signals): void {
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // No such group: fall through to the process itself.
      }
    }
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/** Resolves true when `promise` settles within `timeoutMs`, false otherwise. */
async function settled(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  const timeout = Symbol("timeout");
  // Unref'd: a pending grace timer must not keep the process alive.
  const result = await Promise.race([promise, sleep(timeoutMs, timeout, { ref: false })]);
  return result !== timeout;
}
