import { describe, expect, test, vi } from "vitest";

import { emit, LISTENER_WAIT_MS } from "./emit.js";

function hostWithListener(work: () => Promise<unknown> | undefined): HTMLElement {
  const host = document.createElement("div");
  host.addEventListener("zitadel-test", (event) => {
    const pending = work();
    if (event instanceof CustomEvent && pending) {
      event.detail.waitUntil(pending);
    }
  });
  return host;
}

/**
 * `it` with fake timers: `clock` is Vitest's timer control, started before the
 * test body runs and put back to real timers when the test ends.
 */
const it = test.extend<{ clock: typeof vi }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async clock({}, use) {
    vi.useFakeTimers();
    await use(vi);
    vi.useRealTimers();
  },
});

describe("emit with waitForListeners", () => {
  it("resolves at once when no listener registers work", async ({ clock }) => {
    const done = vi.fn();

    void emit(
      hostWithListener(() => undefined),
      "zitadel-test",
      {},
      { waitForListeners: true },
    ).then(done);
    await clock.advanceTimersByTimeAsync(0);

    expect(done).toHaveBeenCalledOnce();
  });

  it("holds until a registered promise settles, even when it rejects", async ({ clock }) => {
    const host = hostWithListener(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("failed")), 500)),
    );
    const done = vi.fn();

    void emit(host, "zitadel-test", {}, { waitForListeners: true }).then(done);
    await clock.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();

    await clock.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
  });

  it("clears its timer once the listeners have settled", async ({ clock }) => {
    const host = hostWithListener(() => new Promise((resolve) => setTimeout(resolve, 500)));

    void emit(host, "zitadel-test", {}, { waitForListeners: true });
    await clock.advanceTimersByTimeAsync(500);

    expect(clock.getTimerCount()).toBe(0);
  });

  it("takes the fast path with no timer when a listener registers nothing thenable", async ({
    clock,
  }) => {
    const host = document.createElement("div");
    host.addEventListener("zitadel-test", (event) => {
      if (event instanceof CustomEvent) {
        event.detail.waitUntil(undefined);
      }
    });
    const done = vi.fn();

    void emit(host, "zitadel-test", {}, { waitForListeners: true }).then(done);
    await clock.advanceTimersByTimeAsync(0);

    expect(done).toHaveBeenCalledOnce();
    expect(clock.getTimerCount()).toBe(0);
  });

  it("stops waiting for a promise that never settles after the wait limit", async ({ clock }) => {
    const done = vi.fn();

    void emit(
      hostWithListener(() => new Promise(() => {})),
      "zitadel-test",
      {},
      { waitForListeners: true },
    ).then(done);
    await clock.advanceTimersByTimeAsync(LISTENER_WAIT_MS - 1);
    expect(done).not.toHaveBeenCalled();

    await clock.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
  });

  it("leaves the detail untouched and waits for nothing without the option", async ({ clock }) => {
    const host = document.createElement("div");
    const received = vi.fn();
    host.addEventListener("zitadel-test", (event) => {
      received(event instanceof CustomEvent ? event.detail : undefined);
    });
    const done = vi.fn();

    void emit(host, "zitadel-test", { n: 1 }).then(done);
    await clock.advanceTimersByTimeAsync(0);

    expect(received).toHaveBeenCalledWith({ n: 1 });
    expect(done).toHaveBeenCalledOnce();
  });
});
