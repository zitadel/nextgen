import { afterEach, describe, expect, it, vi } from "vitest";

import {
  interruptSignal,
  listenForInterrupt,
  stopListeningForInterrupt,
} from "../../../src/lib/interrupt";

afterEach(() => {
  stopListeningForInterrupt();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function pressCtrlC(): void {
  process.emit("SIGINT", "SIGINT");
}

describe("listenForInterrupt", () => {
  it("holds one listener for the command, however often it starts", () => {
    const idle = process.listenerCount("SIGINT");

    listenForInterrupt();
    listenForInterrupt();

    expect(process.listenerCount("SIGINT")).toBe(idle + 1);
    stopListeningForInterrupt();
    expect(process.listenerCount("SIGINT")).toBe(idle);
  });

  it("aborts the command's signal with E_CANCELLED on Ctrl-C", () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    listenForInterrupt();

    pressCtrlC();

    expect(interruptSignal().aborted).toBe(true);
    expect(interruptSignal().reason).toMatchObject({ code: "E_CANCELLED", exitCode: 130 });
  });

  it("exits 130 when the command is still running after the grace", () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    listenForInterrupt();

    pressCtrlC();
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("exits 130 at once on a second Ctrl-C", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    listenForInterrupt();

    pressCtrlC();
    pressCtrlC();

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("disarms the grace when the command finishes inside it", () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    listenForInterrupt();

    pressCtrlC();
    stopListeningForInterrupt();
    vi.advanceTimersByTime(1_000);

    expect(exit).not.toHaveBeenCalled();
  });

  it("gives the next command a signal of its own", () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    listenForInterrupt();
    pressCtrlC();

    listenForInterrupt();

    expect(interruptSignal().aborted).toBe(false);
  });
});
