import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { Telemetry, TelemetryDeps } from "../../../../src/lib/telemetry";

/** Minimal recording stand-in for the generic Telemetry client. */
class RecordingTelemetry {
  public readonly events: string[] = [];
  public enabled = true;
  public readonly isFirstRun = false;
  public readonly distinctId = "did-test";

  public track(event: string): void {
    this.events.push(event);
  }

  public profile(): void {
    this.events.push("profile");
  }

  public async shutdown(): Promise<void> {
    /* no pending sends in tests */
  }
}

/**
 * A throwaway command that injects {@link RecordingTelemetry} through the
 * `createTelemetry` seam and exposes the protected lifecycle hooks so a test can
 * drive them without oclif's parse/dispatch machinery.
 */
class TestCommand extends BaseCommand {
  public static override readonly id = "telemetry-test";
  public readonly recorder = new RecordingTelemetry();
  public optOut = false;

  protected override createTelemetry(_deps: TelemetryDeps): Telemetry {
    this.recorder.enabled = !this.optOut;
    return this.recorder as unknown as Telemetry;
  }

  // Skip oclif's JSON/stdout machinery in the unit harness.
  public override jsonEnabled(): boolean {
    return false;
  }
  public override log(): void {
    /* swallow human output */
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async open(): Promise<void> {
    await this.toMeta({}, { resolveServer: false, source: "mock" });
  }
  public complete(): void {
    this.emit({ status: "ok", data: {} });
  }
  public async failWith(error: unknown): Promise<void> {
    try {
      await this.catch(error);
    } catch {
      /* catch() ends by throwing oclif's ExitError */
    }
  }
}

function makeCommand(): TestCommand {
  return new TestCommand([], { version: "0.0.0-test" } as unknown as Config);
}

describe("BaseCommand telemetry lifecycle", () => {
  it("fires started on open, then completed on emit, in order", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.complete();
    expect(cmd.recorder.events).toEqual(["cli_command_started", "cli_command_completed"]);
  });

  it("fires started then failed when the command throws", async () => {
    const cmd = makeCommand();
    await cmd.open();
    await cmd.failWith(new Error("boom"));
    expect(cmd.recorder.events).toEqual(["cli_command_started", "cli_command_failed"]);
  });

  it("records nothing when telemetry is opted out (inert)", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    cmd.complete();
    expect(cmd.recorder.events).toEqual([]);
  });
});
