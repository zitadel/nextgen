import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withStartLock } from "../../../../../src/lib/local-server/internal/start-lock";

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

  it("lets only one of two starts at a time do its work", async () => {
    const lock = await lockPath();
    const events: string[] = [];
    const start = (name: string) =>
      withStartLock(
        lock,
        async () => {
          events.push(`${name} begins`);
          await new Promise((resolve) => setTimeout(resolve, 60));
          events.push(`${name} ends`);
        },
        { pollMs: 5 },
      );

    await Promise.all([start("a"), start("b")]);

    const [firstBegin, firstEnd, secondBegin, secondEnd] = events;
    expect(firstBegin?.replace(" begins", "")).toBe(firstEnd?.replace(" ends", ""));
    expect(secondBegin?.replace(" begins", "")).toBe(secondEnd?.replace(" ends", ""));
    expect(events).toHaveLength(4);
  });

  it("takes over a lock whose owner is gone", async () => {
    const lock = await lockPath();
    await withStartLock(lock, async () => undefined);
    await writeFile(lock, "2147483000");

    await expect(withStartLock(lock, async () => "taken", { pollMs: 5 })).resolves.toBe("taken");
  });

  it("gives up with a way out when a live start never finishes", async () => {
    const lock = await lockPath();

    await withStartLock(lock, async () => {
      await expect(
        withStartLock(lock, async () => undefined, { timeoutMs: 30, pollMs: 5 }),
      ).rejects.toMatchObject({
        code: "E_CONFLICT",
        hint: expect.stringContaining(lock),
      });
    });
  });
});
