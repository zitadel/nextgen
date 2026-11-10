import { describe, expect, it, vi } from "vitest";

import { Outbox } from "@/lib/telemetry/outbox";

/** A send that stays in the air until `finish` is called. */
function aSend(): { send: Promise<void>; finish: () => void } {
  const gate = new EventTarget();
  const send = new Promise<void>((resolve) => {
    gate.addEventListener("open", () => resolve(), { once: true });
  });
  return {
    send,
    finish: () => {
      gate.dispatchEvent(new Event("open"));
    },
  };
}

describe("Outbox", () => {
  it("drains at once when nothing was added", async () => {
    await expect(new Outbox().drain(50)).resolves.toBeUndefined();
  });

  it("waits for a send that is still in the air", async () => {
    const outbox = new Outbox();
    const { send, finish } = aSend();
    const finished = vi.fn();
    outbox.add(send);

    const drained = outbox.drain(1000).then(finished);
    await Promise.resolve();

    expect(finished).not.toHaveBeenCalled();
    finish();
    await drained;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("waits for every send added, not only the last", async () => {
    const outbox = new Outbox();
    const first = aSend();
    const second = aSend();
    const finished = vi.fn();
    outbox.add(first.send);
    outbox.add(second.send);

    const drained = outbox.drain(1000).then(finished);
    second.finish();
    await Promise.resolve();

    expect(finished).not.toHaveBeenCalled();
    first.finish();
    await drained;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("gives up at the timeout when a send never ends", async () => {
    const outbox = new Outbox();
    outbox.add(new Promise<void>(() => undefined));

    await expect(outbox.drain(20)).resolves.toBeUndefined();
  });

  it("is not held up by a send that failed", async () => {
    const outbox = new Outbox();
    outbox.add(Promise.reject(new Error("refused")));

    await expect(outbox.drain(50)).resolves.toBeUndefined();
  });
});
