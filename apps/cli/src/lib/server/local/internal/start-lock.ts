import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ZitadelError } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
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
      await createOwned(lockFile);
      return async () => {
        // Only the owner's own lock is removed, so a release that comes after
        // someone else has taken the lock over cannot remove theirs.
        await removeIfOwnedBy(lockFile, process.pid);
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }
    const owner = await readOwner(lockFile);
    const abandoned = owner === undefined ? await isUnwritten(lockFile) : !isAlive(owner);
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
 * itself is exclusive (a second file, created the same way), and the owner is
 * read again once it is held: if the lock has a different owner by then, it is
 * not the stale one and stays. `false` when another start is clearing it.
 *
 * A guard whose own owner died is recovered the same way a lock is released:
 * only if it is still that dead owner's, so a start that saw it a moment ago
 * cannot remove the live guard another start has made since.
 */
export async function clearStale(
  lockFile: string,
  staleOwner: number | undefined,
): Promise<boolean> {
  const guardFile = `${lockFile}.clearing`;
  try {
    await createOwned(guardFile);
  } catch (error) {
    if (!isErrno(error, "EEXIST")) {
      throw error;
    }
    const clearing = await readOwner(guardFile);
    if (clearing === undefined ? await isUnwritten(guardFile) : !isAlive(clearing)) {
      await removeIfOwnedBy(guardFile, clearing);
    }
    return false;
  }
  try {
    await removeIfOwnedBy(lockFile, staleOwner);
  } finally {
    await removeIfOwnedBy(guardFile, process.pid);
  }
  return true;
}

/**
 * Removes `file` only while `owner` holds it; `undefined` stands for an owner
 * that never wrote its pid, and only once it has stayed that way
 * ({@link isUnwritten}).
 *
 * Reading the owner and then removing the file would remove whatever is there
 * by the time of the removal, which may be a live lock made in between. So the
 * file is first moved aside, which takes that very file and no other, and the
 * owner is read from what was moved. A file someone else owns is put back
 * ({@link putBack}).
 */
export async function removeIfOwnedBy(file: string, owner: number | undefined): Promise<void> {
  const aside = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.aside`;
  try {
    await rename(file, aside);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  const found = await readOwner(aside);
  if (found === owner && (owner !== undefined || (await isUnwritten(aside)))) {
    await rm(aside, { force: true });
    return;
  }
  await putBack(aside, file);
}

/**
 * Puts a file moved aside back where it was, never over one made there since:
 * that one is newer and stays, and the moved one is dropped.
 *
 * A link never replaces a file, so it is the way back wherever the filesystem
 * has hard links. Where it does not, the file is renamed back once nothing is
 * there; the moved file is never removed before it is back, so a filesystem
 * that refuses the link cannot cost its owner the lock.
 */
async function putBack(aside: string, file: string): Promise<void> {
  try {
    await link(aside, file);
  } catch (error) {
    if (!isErrno(error, "EEXIST") && !(await exists(file))) {
      await rename(aside, file);
      return;
    }
  }
  await rm(aside, { force: true });
}

/** Whether anything is at `path`. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
