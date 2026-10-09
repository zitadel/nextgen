import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

type DevProcessModule = {
  isDirectRun: (moduleUrl: string, argv?: string[]) => boolean;
  mapWithConcurrency: <T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
  ) => Promise<R[]>;
};

async function loadModule(): Promise<DevProcessModule> {
  return (await import(
    new URL("../../../../../scripts/dev-process.mjs", import.meta.url).href
  )) as DevProcessModule;
}

describe("dev-process helpers", () => {
  it("detects direct script execution when argv[1] is relative", async () => {
    const { isDirectRun } = await loadModule();
    const relativePath = "scripts/run-cli.mjs";
    const moduleUrl = pathToFileURL(resolve(relativePath)).href;

    expect(isDirectRun(moduleUrl, [process.execPath, relativePath])).toBe(true);
  });

  it("returns false for imports or different entrypoints", async () => {
    const { isDirectRun } = await loadModule();
    const moduleUrl = pathToFileURL(resolve("scripts/run-cli.mjs")).href;

    expect(isDirectRun(moduleUrl, [process.execPath])).toBe(false);
    expect(isDirectRun(moduleUrl, [process.execPath, "scripts/doctor.mjs"])).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in results and never exceeds the limit", async () => {
    const { mapWithConcurrency } = await loadModule();

    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later items finish faster to prove results are ordered by input,
      // not by completion.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, item * 4));
      inFlight -= 1;
      return item * 10;
    });

    expect(results).toEqual([50, 40, 30, 20, 10]);
    expect(peak).toBe(2);
  });

  it("stops starting new work after a failure and rethrows the first error", async () => {
    const { mapWithConcurrency } = await loadModule();

    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 1) {
          throw new Error(`boom on ${item}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        return item;
      }),
    ).rejects.toThrow("boom on 1");

    // Lanes finish their in-flight item but pull nothing new once failed.
    expect(started.length).toBeLessThan(6);
  });

  it("handles empty input and limits larger than the input", async () => {
    const { mapWithConcurrency } = await loadModule();

    await expect(mapWithConcurrency([], 4, async () => "x")).resolves.toEqual([]);
    await expect(
      mapWithConcurrency(["a", "b"], 16, async (item, index) => `${item}${index}`),
    ).resolves.toEqual(["a0", "b1"]);
  });

  it("rejects limits that are not positive integers instead of silently no-oping", async () => {
    const { mapWithConcurrency } = await loadModule();

    // A NaN limit previously produced zero worker lanes: the call returned
    // an all-undefined result array without running any work.
    for (const limit of [Number.NaN, 0, -1, 2.5, Number.POSITIVE_INFINITY]) {
      await expect(mapWithConcurrency(["a"], limit, async (item) => item)).rejects.toThrow(
        "positive integer limit",
      );
    }
  });
});
