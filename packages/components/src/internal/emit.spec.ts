import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitThenSettle, LISTENER_WAIT_MS } from "./emit.js";

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

describe("emitThenSettle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves at once when no listener registers work", async () => {
    const done = vi.fn();

    void emitThenSettle(
      hostWithListener(() => undefined),
      "zitadel-test",
      {},
    ).then(done);
    await vi.advanceTimersByTimeAsync(0);

    expect(done).toHaveBeenCalledOnce();
  });

  it("holds until a registered promise settles, even when it rejects", async () => {
    const host = hostWithListener(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("failed")), 500)),
    );
    const done = vi.fn();

    void emitThenSettle(host, "zitadel-test", {}).then(done);
    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
  });

  it("stops waiting for a promise that never settles after the wait limit", async () => {
    const done = vi.fn();

    void emitThenSettle(
      hostWithListener(() => new Promise(() => {})),
      "zitadel-test",
      {},
    ).then(done);
    await vi.advanceTimersByTimeAsync(LISTENER_WAIT_MS - 1);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
  });
});
