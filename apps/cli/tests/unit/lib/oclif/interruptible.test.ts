import { Command, type Config } from "@oclif/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Interruptible } from "@/lib/oclif/interruptible";

/** A command that only exposes what the mixin gives it. */
class Probe extends Interruptible(Command) {
  public async run(): Promise<void> {}

  public get cancel(): AbortSignal {
    return this.signal;
  }

  public listen(): void {
    this.listenForInterrupt();
  }

  public stop(): void {
    this.stopListeningForInterrupt();
  }
}

function probe(): Probe {
  return new Probe([], {} as unknown as Config);
}

function pressCtrlC(): void {
  process.emit("SIGINT", "SIGINT");
}

function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
}

const running: Probe[] = [];

function listening(): Probe {
  const command = probe();
  running.push(command);
  command.listen();
  return command;
}

afterEach(() => {
  for (const command of running.splice(0)) {
    command.stop();
  }
  vi.useRealTimers();
});

describe("Interruptible", () => {
  it("holds one listener for the command, however often it starts", () => {
    const idle = process.listenerCount("SIGINT");
    const command = listening();

    command.listen();

    expect(process.listenerCount("SIGINT")).toBe(idle + 1);
    command.stop();
    expect(process.listenerCount("SIGINT")).toBe(idle);
  });

  it("leaves the signal unaborted until Ctrl-C", () => {
    const command = listening();

    expect(command.cancel.aborted).toBe(false);
  });

  it("aborts the command's signal with E_CANCELLED on Ctrl-C", () => {
    stubExit();
    const command = listening();

    pressCtrlC();

    expect(command.cancel.aborted).toBe(true);
    expect(command.cancel.reason).toMatchObject({ code: "E_CANCELLED", exitCode: 130 });
  });

  it("keeps the signal aborted after the first Ctrl-C", () => {
    stubExit();
    const command = listening();

    pressCtrlC();
    command.stop();

    expect(command.cancel.aborted).toBe(true);
  });

  it("exits 130 when the command is still running after the grace", () => {
    vi.useFakeTimers();
    const exit = stubExit();
    listening();

    pressCtrlC();
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("exits 130 at once on a second Ctrl-C", () => {
    const exit = stubExit();
    listening();

    pressCtrlC();
    pressCtrlC();

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("disarms the grace when the command finishes inside it", () => {
    vi.useFakeTimers();
    const exit = stubExit();
    const command = listening();

    pressCtrlC();
    command.stop();
    vi.advanceTimersByTime(1_000);

    expect(exit).not.toHaveBeenCalled();
  });

  it("gives each command a signal of its own", () => {
    stubExit();
    const first = listening();
    pressCtrlC();

    const second = listening();

    expect(first.cancel.aborted).toBe(true);
    expect(second.cancel.aborted).toBe(false);
  });
});
