import { describe, expect, it } from "vitest";

import { BaseCommand } from "@/lib/oclif/base";
import { aConfigAt } from "@tests/helpers/suggestions";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";

/** Minimal recording stand-in for the generic Telemetry client. */
class RecordingTelemetry {
  public readonly events: string[] = [];
  public readonly sent: { event: string; properties: Record<string, unknown> }[] = [];
  public enabled = true;
  public readonly isFirstRun = false;
  public readonly distinctId = "did-test";

  public track(event: string, properties: Record<string, unknown> = {}): void {
    this.events.push(event);
    this.sent.push({ event, properties });
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
  public static override readonly id: string = "telemetry-test";
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

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async open(): Promise<void> {
    await this.toMeta({}, { source: "mock" });
  }
  public complete(): void {
    this.emit({ summary: { title: "Done", sections: [] }, status: "ok", data: {} });
  }
  public record(patch: Record<string, string | undefined>): void {
    this.recordTelemetry(patch);
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

/** A command whose id is one that reports an action, so its outcome is one too. */
class GrantCreate extends TestCommand {
  public static override readonly id: string = "grant:create";
}

function makeActionCommand(): GrantCreate {
  return new GrantCreate([], aConfigAt("0.0.0-test"));
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


  describe("action events", () => {
    it("reports a successful command's action after its completed event, with what it recorded", async () => {
      const cmd = makeActionCommand();
      await cmd.open();
      cmd.record({ access_level: "project_admin" });
      cmd.complete();

      expect(cmd.recorder.events).toEqual([
        "cli_command_started",
        "cli_command_completed",
        "action_completed",
      ]);
      expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({
        action: "create",
        resource_type: "grant",
        access_level: "project_admin",
        surface: "cli",
      });
    });

    it("reports a failed command's action with the error code", async () => {
      const cmd = makeActionCommand();
      await cmd.open();
      await cmd.failWith(new Error("boom"));

      expect(cmd.recorder.events.at(-1)).toBe("action_failed");
      expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({
        action: "create",
        resource_type: "grant",
        reason: "E_VALIDATION",
      });
    });

    it("reports no action for a command that has none", async () => {
      const cmd = makeCommand();
      await cmd.open();
      cmd.complete();

      expect(cmd.recorder.events).not.toContain("action_completed");
    });

    it("reports no action when telemetry is opted out", async () => {
      const cmd = makeActionCommand();
      cmd.optOut = true;
      await cmd.open();
      cmd.complete();

      expect(cmd.recorder.events).toEqual([]);
    });
  });
});
