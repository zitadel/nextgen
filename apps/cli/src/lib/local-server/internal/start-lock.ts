import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { ZitadelError } from "../../errors";

type LockOptions = Readonly<{
  /** How long to wait for another start to finish. */
  timeoutMs?: number;
  pollMs?: number;
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
  await acquire(lockFile, options.timeoutMs ?? 120_000, options.pollMs ?? 200);
  try {
    return await work();
  } finally {
    await rm(lockFile, { force: true });
  }
}

async function acquire(lockFile: string, timeoutMs: number, pollMs: number): Promise<void> {
  await mkdir(dirname(lockFile), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const owner = await readOwner(lockFile);
    if (owner !== undefined && !isAlive(owner)) {
      await rm(lockFile, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new ZitadelError(
        "E_CONFLICT",
        "Another `zitadel start` is still running in this directory",
        {
          hint: `Wait for it to finish, or delete ${lockFile} if no start is running.`,
          details: { lock_file: lockFile, owner_pid: owner },
        },
      );
    }
    await sleep(pollMs);
  }
}

/** The pid in the lock, or `undefined` while it is being written or when it is unreadable. */
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
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
