import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tryLock, withStartLock } from "../../../../../src/lib/local-server/internal/start-lock";
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
