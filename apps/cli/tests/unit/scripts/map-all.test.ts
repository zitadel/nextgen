import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

type MapAll = <T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
) => Promise<R[]>;

const { mapAll } = (await import(
  new URL("../../../../../scripts/map-all.mjs", import.meta.url).href
)) as { mapAll: MapAll };

describe("mapAll", () => {
  it("returns the results in input order", async () => {
    await expect(mapAll([3, 1, 2], async (item) => item * 10, 2)).resolves.toEqual([30, 10, 20]);
  });

  it("rethrows the failed job's own error, not a wrapper around it", async () => {
    await expect(
      mapAll(
        ["a", "b"],
        async (item) => {
          throw new Error(`boom on ${item}`);
        },
        1,
      ),
    ).rejects.toThrow("boom on a");
  });

  it("lets the jobs already running finish before it fails", async () => {
    const started = performance.now();

    await expect(
      mapAll(
        [0, 1],
        async (item) => {
          if (item === 0) {
            throw new Error("boom");
          }
          await delay(40);
        },
        2,
      ),
    ).rejects.toThrow("boom");

    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
  });
});
