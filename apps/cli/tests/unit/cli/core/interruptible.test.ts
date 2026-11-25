import { Command, type Config } from "@oclif/core";
import { describe, expect, onTestFinished, vi } from "vitest";

import { Interruptible } from "@/cli/core/interruptible";
import { it } from "@tests/fixtures";

/** A command that only exposes what the mixin gives it. */
class Probe extends Interruptible(Command) {
  public async run(): Promise<void> {}

  public get cancel(): AbortSignal {
    return this.signal;
  }

  public get report() {
    return this.cancellation;
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

function listening(): Probe {
  const command = probe();
  onTestFinished(() => {
    command.stop();
  });
  command.listen();
  return command;
}

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

  it("aborts the command's signal with an AbortError on Ctrl-C", () => {
    stubExit();
    const command = listening();

    pressCtrlC();

    expect(command.cancel.aborted).toBe(true);
    expect(command.cancel.reason).toMatchObject({
      name: "AbortError",
      message: "Cancelled",
    });
  });

  it("reports nothing while the run goes on", () => {
    expect(listening().report).toBeUndefined();
  });

  it("reports Ctrl-C as the one word it ends on, with a hint, exiting 130", () => {
    stubExit();
    const command = listening();

    pressCtrlC();

    expect(command.report).toMatchObject({
      code: "E_CANCELLED",
      message: "Cancelled",
      hint: "The command was cancelled with Ctrl-C.",
      exitCode: 130,
    });
  });

  it("keeps the signal aborted after the first Ctrl-C", () => {
    stubExit();
    const command = listening();

    pressCtrlC();
    command.stop();

    expect(command.cancel.aborted).toBe(true);
  });

  it("exits 130 when the command is still running after the grace", ({ clock }) => {
    const exit = stubExit();
    listening();

    pressCtrlC();
    expect(exit).not.toHaveBeenCalled();
    clock.advance(1_000);

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("exits 130 at once on a second Ctrl-C", () => {
    const exit = stubExit();
    listening();

    pressCtrlC();
    pressCtrlC();

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("disarms the grace when the command finishes inside it", ({ clock }) => {
    const exit = stubExit();
    const command = listening();

    pressCtrlC();
    command.stop();
    clock.advance(1_000);

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
