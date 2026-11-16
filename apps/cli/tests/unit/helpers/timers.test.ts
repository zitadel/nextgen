import * as timers from "node:timers/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

describe("node:timers/promises under the shared setup", () => {
  it("resolves with the given value once fake timers advance past the delay", async ({ clock }) => {
    const waited = sleep(10_000, "done");

    await clock.advanceAsync(10_000);

    await expect(waited).resolves.toBe("done");
  });

  it("rejects with an AbortError when the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const waited = sleep(10_000, undefined, { signal: controller.signal });

    controller.abort();

    await expect(waited).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
  });

  it("rejects at once when the signal is already aborted", async () => {
    await expect(sleep(10_000, undefined, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("does not let a ref: false wait keep the process alive", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const waited = sleep(10, undefined, { ref: false });

    const timer = setTimeoutSpy.mock.results[0]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    await waited;
  });

  it("leaves the other exports of the module as they are", () => {
    expect(timers.setImmediate).toBeTypeOf("function");
    expect(timers.setInterval).toBeTypeOf("function");
    expect(timers.scheduler).toBeDefined();
  });
});
