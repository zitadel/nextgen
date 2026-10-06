import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

/** A fresh copy of the module, so one test's Ctrl-C does not leak into the next. */
async function load() {
  return import("../../../src/lib/interrupt");
}

describe("interruptible", () => {
  it("listens for Ctrl-C only while work is in flight", async () => {
    const { interruptible } = await load();
    const before = process.listenerCount("SIGINT");

    let during = 0;
    await interruptible(async () => {
      during = process.listenerCount("SIGINT");
    });

    expect(during).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("holds one listener however many requests overlap", async () => {
    const { interruptible } = await load();
    const before = process.listenerCount("SIGINT");
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));

    const first = interruptible(() => gate);
    const second = interruptible(() => gate);
    expect(process.listenerCount("SIGINT")).toBe(before + 1);

    release();
    await Promise.all([first, second]);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("aborts the command's signal with E_CANCELLED on Ctrl-C, and keeps it aborted", async () => {
    const { interruptible, interruptSignal } = await load();

    await interruptible(async () => {
      process.emit("SIGINT", "SIGINT");
    });
    await interruptible(() => Promise.resolve());

    expect(interruptSignal().aborted).toBe(true);
    expect(interruptSignal().reason).toMatchObject({ code: "E_CANCELLED", exitCode: 130 });
  });

  it("gives the next command a signal of its own", async () => {
    const { interruptible, interruptSignal, resetInterrupt } = await load();
    await interruptible(async () => {
      process.emit("SIGINT", "SIGINT");
    });

    resetInterrupt();

    expect(interruptSignal().aborted).toBe(false);
  });
});
