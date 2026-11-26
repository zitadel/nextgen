import { readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { LocalServerBusyError } from "@/lib/server";
import {
  clearStale,
  tryLock,
  UNWRITTEN_LOCK_MS,
  withStartLock,
} from "@/lib/server/local/internal/start-lock";
import { ManualClock } from "@tests/fixtures/clock";
import { it } from "@tests/fixtures";

/** The pid of a start that is no longer running. */
const DEAD_OWNER = 2147483000;

/**
 * Where a start lock lives under a directory.
 *
 * @param dir - The directory the lock's `local` folder is in.
 * @returns The lock file's path.
 */
function lockPath(dir: string): string {
  return join(dir, "local", "start.lock");
}

describe("tryLock", () => {
  it("takes a lock nobody has", async ({ dir }) => {
    const lock = lockPath(dir);

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });

  it("does not take a lock a live start has, and does not wait for it", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);

    await expect(tryLock(lock)).resolves.toBeUndefined();
  });

  it("takes the lock again once it is released", async ({ dir }) => {
    const lock = lockPath(dir);
    const release = await tryLock(lock);
    await release?.();

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });

  it("takes over a lock whose owner is gone", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });
});

describe("tryLock when two starts find the same dead owner", () => {
  it("lets only one of them take the lock", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    const taken = await Promise.all([tryLock(lock), tryLock(lock), tryLock(lock), tryLock(lock)]);

    expect(taken.filter((release) => release !== undefined)).toHaveLength(1);
  });

  it("leaves the lock of the one that won", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await Promise.all([tryLock(lock), tryLock(lock)]);

    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
  });

  it("does not leave the file it cleared the lock with behind", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await tryLock(lock);

    await expect(stat(`${lock}.clearing`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("clearStale", () => {
  it("leaves a lock that has another owner by the time it is cleared", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);

    await clearStale(lock, 2147483000);

    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
  });

  it("removes a lock that still has the stale owner", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await clearStale(lock, 2147483000);

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing while another start is clearing", async ({ dir }) => {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "2147483000");
    await writeFile(`${lock}.clearing`, String(process.pid));

    await expect(clearStale(lock, 2147483000)).resolves.toBe(false);
    await expect(readFile(lock, "utf8")).resolves.toBe("2147483000");
  });

  describe("when a start died while clearing", () => {
    /**
     * A lock a dead start left, with the guard of another start that died
     * while clearing it.
     *
     * @param dir - The directory the lock is made under.
     * @returns The lock file's path.
     */
    async function aLockSomeoneDiedClearing(dir: string): Promise<string> {
      const lock = lockPath(dir);
      await tryLock(lock);
      await writeFile(lock, String(DEAD_OWNER));
      await writeFile(`${lock}.clearing`, String(DEAD_OWNER));
      return lock;
    }

    it("still removes the lock", async ({ dir }) => {
      const lock = await aLockSomeoneDiedClearing(dir);

      await clearStale(lock, DEAD_OWNER);

      await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("leaves the dead start's guard, so no start that saw it can remove a live one", async ({
      dir,
    }) => {
      const lock = await aLockSomeoneDiedClearing(dir);

      await clearStale(lock, DEAD_OWNER);

      await expect(readFile(`${lock}.clearing`, "utf8")).resolves.toBe(String(DEAD_OWNER));
    });

    it("leaves nothing of its own behind", async ({ dir }) => {
      const lock = await aLockSomeoneDiedClearing(dir);

      await clearStale(lock, DEAD_OWNER);

      await expect(readdir(join(dir, "local"))).resolves.toEqual(["start.lock.clearing"]);
    });

    it("does nothing while the start that took over from it is clearing", async ({ dir }) => {
      const lock = await aLockSomeoneDiedClearing(dir);
      await writeFile(`${lock}.clearing.2`, String(process.pid));

      await expect(clearStale(lock, DEAD_OWNER)).resolves.toBe(false);
      await expect(readFile(lock, "utf8")).resolves.toBe(String(DEAD_OWNER));
    });
  });
});

describe("a lock with no owner in it", () => {
  /**
   * A lock file with no owner written into it, as old as given.
   *
   * @param dir - The directory the lock is made under.
   * @param ageMs - How long ago it was last touched, in milliseconds.
   * @returns The lock file's path.
   */
  async function emptyLock(dir: string, ageMs: number): Promise<string> {
    const lock = lockPath(dir);
    await tryLock(lock);
    await writeFile(lock, "");
    const then = new Date(Date.now() - ageMs);
    await utimes(lock, then, then);
    return lock;
  }

  it("is left alone when it is new, because its start may be about to write its pid", async ({
    dir,
  }) => {
    await expect(tryLock(await emptyLock(dir, 0))).resolves.toBeUndefined();
  });

  it("is taken over once it has stayed empty, because its start died before writing", async ({
    dir,
  }) => {
    await expect(tryLock(await emptyLock(dir, UNWRITTEN_LOCK_MS + 1000))).resolves.toBeTypeOf(
      "function",
    );
  });
});

describe("releasing a lock", () => {
  it("does not remove a lock that someone else holds now", async ({ dir }) => {
    const lock = lockPath(dir);
    const release = await tryLock(lock);
    await writeFile(lock, "2147483000");

    await release?.();

    await expect(readFile(lock, "utf8")).resolves.toBe("2147483000");
  });
});

describe("withStartLock", () => {
  it("runs the work and removes the lock", async ({ dir }) => {
    const lock = lockPath(dir);

    await expect(withStartLock(lock, async () => "done")).resolves.toBe("done");

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the lock when the work fails", async ({ dir }) => {
    const lock = lockPath(dir);

    await expect(
      withStartLock(lock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("holds the lock while the work runs", async ({ dir }) => {
    const lock = lockPath(dir);

    await withStartLock(lock, async () => {
      await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
    });
  });

  it("makes a second start wait until the first has finished", async ({ dir }) => {
    const lock = lockPath(dir);
    const events: string[] = [];
    const begun: (() => void)[] = [];
    const firstHasBegun = new Promise<void>((resolve) => begun.push(resolve));
    const finish: (() => void)[] = [];
    const firstMayFinish = new Promise<void>((resolve) => finish.push(resolve));
    const first = withStartLock(lock, async () => {
      events.push("first begins");
      begun[0]?.();
      await firstMayFinish;
      events.push("first ends");
    });
    await firstHasBegun;

    const second = withStartLock(
      lock,
      async () => {
        events.push("second begins");
      },
      { clock: new ManualClock(() => finish[0]?.()) },
    );
    await Promise.all([first, second]);

    expect(events).toEqual(["first begins", "first ends", "second begins"]);
  });

  it("takes over a lock whose owner is gone", async ({ dir }) => {
    const lock = lockPath(dir);
    await withStartLock(lock, async () => undefined);
    await writeFile(lock, "2147483000");

    await expect(withStartLock(lock, async () => "taken")).resolves.toBe("taken");
  });

  it("gives up with a way out when a live start never finishes", async ({ dir }) => {
    const lock = lockPath(dir);
    const release = await tryLock(lock);

    const rejection = expect(
      withStartLock(lock, async () => undefined, {
        timeoutMs: 100,
        pollMs: 10,
        clock: new ManualClock(),
      }),
    ).rejects;
    await rejection.toBeInstanceOf(LocalServerBusyError);
    await rejection.toMatchObject({
      code: "E_CONFLICT",
      retryable: true,
      message: expect.stringContaining(lock),
      lockFile: lock,
    });
    await release?.();
  });
});
