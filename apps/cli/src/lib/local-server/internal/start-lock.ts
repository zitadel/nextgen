import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ZitadelError, isErrno } from "../../errors";
import { type Clock, realClock } from "./clock";

type LockOptions = Readonly<{
  /** How long to wait for another start to finish. */
  timeoutMs?: number;
  pollMs?: number;
  clock?: Clock;
}>;

/**
 * Runs `work` as the only start in a directory. Two starts at once would pick
 * the same port and then run two servers over one data directory, so the second
 * waits for the first and then finds its server already running.
 *
 * The lock is a file holding the pid of the start that owns it. A lock whose
 * owner is gone is taken over, so a start that crashed cannot block the next.
 */
export async function withStartLock<T>(
  lockFile: string,
  work: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const release = await acquireLock(lockFile, options);
  try {
    return await work();
  } finally {
    await release();
  }
}

/**
 * Takes the lock without waiting. `undefined` when a live start has it.
 *
 * The file is created exclusively, so only one process can create it. If it
 * exists, its owner is asked whether it is still alive: a lock left by a start
 * that crashed must not block every later one, so a dead owner's lock is taken
 * over. The same lock, in a folder shared by the machine, is what claims a port
 * (see `TcpPorts.reserve`).
 */
export async function tryLock(lockFile: string): Promise<(() => Promise<void>) | undefined> {
  await mkdir(dirname(lockFile), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => rm(lockFile, { force: true });
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }
    const owner = await readOwner(lockFile);
    if (owner === undefined || isAlive(owner)) {
      return undefined;
    }
    await rm(lockFile, { force: true });
  }
}

async function acquireLock(lockFile: string, options: LockOptions): Promise<() => Promise<void>> {
  const clock = options.clock ?? realClock;
  const deadline = clock.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 200;
  for (;;) {
    const release = await tryLock(lockFile);
    if (release) {
      return release;
    }
    if (clock.now() >= deadline) {
      throw new ZitadelError(
        "E_CONFLICT",
        "Another `zitadel start` is still running in this directory",
        {
          hint: `Wait for it to finish, or delete ${lockFile} if no start is running.`,
          details: { lock_file: lockFile, owner_pid: await readOwner(lockFile) },
        },
      );
    }
    await clock.wait(pollMs);
  }
}

/**
 * The pid in the lock, or `undefined` while it is being written or when it is
 * unreadable. An unreadable lock counts as held: it is most likely a start that
 * has created the file and not yet written its pid.
 */
async function readOwner(lockFile: string): Promise<number | undefined> {
  try {
    const pid = Number.parseInt(await readFile(lockFile, "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}
