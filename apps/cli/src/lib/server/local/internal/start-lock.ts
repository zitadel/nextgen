import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { LocalServerBusyError } from "@/lib/server/errors";
import { isErrno } from "@/lib/errno";
import { type Clock, SystemClock } from "@/lib/clock";

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
      await createOwned(lockFile);
      return async () => {
        // Only the owner's own lock is removed, so a release that comes after
        // someone else has taken the lock over cannot remove theirs.
        if ((await readOwner(lockFile)) === process.pid) {
          await rm(lockFile, { force: true });
        }
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }
    const owner = await readOwner(lockFile);
    const abandoned =
      (owner === undefined && (await isUnwritten(lockFile))) ||
      (owner !== undefined && !isAlive(owner));
    if (!abandoned || !(await clearStale(lockFile, owner))) {
      return undefined;
    }
  }
}

/** Creates the file exclusively and writes the owner into it; a file that could not be written is not left behind empty. */
async function createOwned(file: string): Promise<void> {
  try {
    await writeFile(file, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isErrno(error, "EEXIST")) {
      await rm(file, { force: true });
    }
    throw error;
  }
}

/** How long a lock may stay without an owner in it before it is taken to be abandoned: far longer than writing a pid takes. */
export const UNWRITTEN_LOCK_MS = 10_000;

/**
 * Whether a lock with no readable owner has been that way for a while. It is
 * normally a start that has created the file and not yet written its pid, and
 * is left alone; one that stays so is a start that died between the two.
 */
async function isUnwritten(lockFile: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockFile)).mtimeMs > UNWRITTEN_LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Removes the lock of a dead owner. Two starts that both saw the same dead owner
 * must not both remove it: the first would then take the lock, and the second,
 * removing it a moment later, would remove the first's live one. So removal
 * itself is exclusive (a guard, see {@link takeGuard}), and the owner is read
 * again once it is held: if the lock has a different owner by then, it is not
 * the stale one and stays. `false` when another start is clearing it.
 */
export async function clearStale(
  lockFile: string,
  staleOwner: number | undefined,
): Promise<boolean> {
  const release = await takeGuard(`${lockFile}.clearing`);
  if (!release) {
    return false;
  }
  try {
    if ((await readOwner(lockFile)) === staleOwner) {
      await rm(lockFile, { force: true });
    }
  } finally {
    await release();
  }
  return true;
}

/** How many starts may have died while clearing one lock before the next stops trying to clear it. */
const GUARD_GENERATIONS = 32;

/**
 * Takes the guard that makes clearing a lock exclusive, or `undefined` while a
 * live start has it.
 *
 * The guard is a file created exclusively, like the lock. A start that died
 * while holding it leaves it behind, and that file is never removed: a file
 * can only be removed by its path, so a start that saw the dead owner a moment
 * ago could remove the live guard another start has made there since, and two
 * starts would clear at once. A dead guard is passed over instead, for the
 * next file in line. A file is only reached past dead ones, and dead ones stay,
 * so one live start holds the guard at a time. Only the holder removes its own
 * file. Each start that dies while clearing costs one small file.
 */
async function takeGuard(guardFile: string): Promise<(() => Promise<void>) | undefined> {
  for (const file of [
    guardFile,
    ...Array.from({ length: GUARD_GENERATIONS - 1 }, (_, index) => {
      return `${guardFile}.${index + 2}`;
    }),
  ]) {
    try {
      await createOwned(file);
      return async () => {
        await rm(file, { force: true });
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }
    const holder = await readOwner(file);
    if (
      (holder === undefined && !(await isUnwritten(file))) ||
      (holder !== undefined && isAlive(holder))
    ) {
      return undefined;
    }
  }
  return undefined;
}

async function acquireLock(lockFile: string, options: LockOptions): Promise<() => Promise<void>> {
  const clock = options.clock ?? new SystemClock();
  const deadline = clock.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 200;
  for (;;) {
    const release = await tryLock(lockFile);
    if (release) {
      return release;
    }
    if (clock.now() >= deadline) {
      throw new LocalServerBusyError({ lock_file: lockFile, owner_pid: await readOwner(lockFile) });
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
    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    } else {
      return undefined;
    }
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
