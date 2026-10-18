import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearStale,
  tryLock,
  UNWRITTEN_LOCK_MS,
  withStartLock,
} from "../../../../../src/lib/local-server/internal/start-lock";
import { ManualClock } from "../../../../helpers/clock";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function lockPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-lock-"));
  dirs.push(dir);
  return join(dir, "local", "start.lock");
}

describe("tryLock", () => {
  it("takes a lock nobody has", async () => {
    const lock = await lockPath();

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });

  it("does not take a lock a live start has, and does not wait for it", async () => {
    const lock = await lockPath();
    await tryLock(lock);

    await expect(tryLock(lock)).resolves.toBeUndefined();
  });

  it("takes the lock again once it is released", async () => {
    const lock = await lockPath();
    const release = await tryLock(lock);
    await release?.();

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });

  it("takes over a lock whose owner is gone", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await expect(tryLock(lock)).resolves.toBeTypeOf("function");
  });
});

describe("tryLock when two starts find the same dead owner", () => {
  it("lets only one of them take the lock", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    const taken = await Promise.all([tryLock(lock), tryLock(lock), tryLock(lock), tryLock(lock)]);

    expect(taken.filter((release) => release !== undefined)).toHaveLength(1);
  });

  it("leaves the lock of the one that won", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await Promise.all([tryLock(lock), tryLock(lock)]);

    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
  });

  it("does not leave the file it cleared the lock with behind", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await tryLock(lock);

    await expect(stat(`${lock}.clearing`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("clearStale", () => {
  it("leaves a lock that has another owner by the time it is cleared", async () => {
    const lock = await lockPath();
    await tryLock(lock);

    await clearStale(lock, 2147483000);

    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
  });

  it("removes a lock that still has the stale owner", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");

    await clearStale(lock, 2147483000);

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing while another start is clearing", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "2147483000");
    await writeFile(`${lock}.clearing`, String(process.pid));

    await expect(clearStale(lock, 2147483000)).resolves.toBe(false);
    await expect(readFile(lock, "utf8")).resolves.toBe("2147483000");
  });

  it("clears the way of a start that died while clearing", async () => {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(`${lock}.clearing`, "2147483000");

    await clearStale(lock, 2147483000);

    await expect(stat(`${lock}.clearing`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("a lock with no owner in it", () => {
  async function emptyLock(ageMs: number): Promise<string> {
    const lock = await lockPath();
    await tryLock(lock);
    await writeFile(lock, "");
    const then = new Date(Date.now() - ageMs);
    await utimes(lock, then, then);
    return lock;
  }

  it("is left alone when it is new, because its start may be about to write its pid", async () => {
    await expect(tryLock(await emptyLock(0))).resolves.toBeUndefined();
  });

  it("is taken over once it has stayed empty, because its start died before writing", async () => {
    await expect(tryLock(await emptyLock(UNWRITTEN_LOCK_MS + 1000))).resolves.toBeTypeOf(
      "function",
    );
  });
});

describe("releasing a lock", () => {
  it("does not remove a lock that someone else holds now", async () => {
    const lock = await lockPath();
    const release = await tryLock(lock);
    await writeFile(lock, "2147483000");

    await release?.();

    await expect(readFile(lock, "utf8")).resolves.toBe("2147483000");
  });
});

describe("withStartLock", () => {
  it("runs the work and removes the lock", async () => {
    const lock = await lockPath();

    await expect(withStartLock(lock, async () => "done")).resolves.toBe("done");

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the lock when the work fails", async () => {
    const lock = await lockPath();

    await expect(
      withStartLock(lock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("holds the lock while the work runs", async () => {
    const lock = await lockPath();

    await withStartLock(lock, async () => {
      await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
    });
  });

  it("makes a second start wait until the first has finished", async () => {
    const lock = await lockPath();
    const events: string[] = [];
    let begun!: () => void;
    const firstHasBegun = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let finish!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = withStartLock(lock, async () => {
      events.push("first begins");
      begun();
      await firstMayFinish;
      events.push("first ends");
    });
    await firstHasBegun;

    const second = withStartLock(
      lock,
      async () => {
        events.push("second begins");
      },
      { clock: new ManualClock(finish) },
    );
    await Promise.all([first, second]);

    expect(events).toEqual(["first begins", "first ends", "second begins"]);
  });

  it("takes over a lock whose owner is gone", async () => {
    const lock = await lockPath();
    await withStartLock(lock, async () => undefined);
    await writeFile(lock, "2147483000");

    await expect(withStartLock(lock, async () => "taken")).resolves.toBe("taken");
  });

  it("gives up with a way out when a live start never finishes", async () => {
    const lock = await lockPath();
    const release = await tryLock(lock);

    await expect(
      withStartLock(lock, async () => undefined, {
        timeoutMs: 100,
        pollMs: 10,
        clock: new ManualClock(),
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT", hint: expect.stringContaining(lock) });
    await release?.();
  });
});
