import { describe, expect, it } from "vitest";

import { BaseCommand } from "@/cli/core/base";
import { aConfigAt } from "@tests/helpers/suggestions";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";

/** Minimal recording stand-in for the generic Telemetry client. */
class RecordingTelemetry {
  public readonly events: string[] = [];
  public readonly properties: Record<string, unknown>[] = [];
  public enabled = true;
  public readonly isFirstRun = false;
  public readonly distinctId = "did-test";

  public track(event: string, properties: Record<string, unknown> = {}): void {
    this.events.push(event);
    this.properties.push(properties);
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
  public consentFlag: boolean | undefined;

  protected override createTelemetry(deps: TelemetryDeps): Telemetry {
    this.consentFlag = deps.flag;
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

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async open(): Promise<void> {
    await this.toMeta({}, { source: "mock" });
  }
  public send(event: string, properties: Record<string, string>): void {
    this.trackEvent(event, properties);
  }
  public complete(): void {
    this.emit({ summary: { title: "Done", sections: [] }, status: "ok", data: {} });
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
  return new TestCommand([], aConfigAt("0.0.0-test"));
}

describe("BaseCommand telemetry opt-out", () => {
  it("is read from the words the command was run with when it fails before telemetry opens", async () => {
    const cmd = new TestCommand(["--no-telemetry"], aConfigAt("0.0.0-test"));

    await cmd.failWith(new Error("refused"));

    expect(cmd.consentFlag).toBe(false);
  });

  it("leaves the decision to the other signals when the words do not opt out", async () => {
    const cmd = new TestCommand([], aConfigAt("0.0.0-test"));

    await cmd.failWith(new Error("refused"));

    expect(cmd.consentFlag).toBeUndefined();
  });
});

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

  it("sends a product event with its properties and the command's context", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.send("invitation_created", { role: "project_viewer", invitation_journey_id: "journey_1" });

    expect(cmd.recorder.events).toEqual(["cli_command_started", "invitation_created"]);
    expect(cmd.recorder.properties[1]).toMatchObject({
      role: "project_viewer",
      invitation_journey_id: "journey_1",
      command: "telemetry-test",
    });
    expect(cmd.recorder.properties[1]).toMatchObject({
      invocation_id: cmd.recorder.properties[0]?.invocation_id,
    });
  });

  it("sends no product event when telemetry is opted out", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    cmd.send("invitation_created", { role: "project_viewer", invitation_journey_id: "journey_1" });

    expect(cmd.recorder.events).toEqual([]);
  });

  it("records nothing when telemetry is opted out (inert)", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    cmd.complete();
    expect(cmd.recorder.events).toEqual([]);
  });
});
