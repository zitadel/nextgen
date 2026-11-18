import { describe, expect, it } from "vitest";

import { type FlowReport, Telemetered } from "@/cli/telemetry/telemetered";
import { ZitadelError } from "@/lib/errors";
import { BaseCommand, type Facts } from "@/lib/oclif/base";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";
import type { RunWatcher } from "@/lib/wizard";
import { aConfigAt } from "@tests/helpers/suggestions";

/** What one event was sent with, and the destinations it was limited to. */
type Sent = {
  readonly event: string;
  readonly properties: Record<string, unknown>;
  readonly only: readonly string[] | undefined;
};

/** Minimal recording stand-in for the generic Telemetry client. */
class RecordingTelemetry {
  public readonly sent: Sent[] = [];
  public enabled = true;
  public readonly isFirstRun = false;
  public readonly distinctId = "did-test";

  public track(
    event: string,
    properties: Record<string, unknown> = {},
    only?: readonly string[],
  ): void {
    this.sent.push({ event, properties, only });
  }

  public profile(): void {
    /* no profile in this harness */
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
class TestCommand extends Telemetered(BaseCommand) {
  public static override readonly id: string = "telemetry-test";
  public readonly recorder = new RecordingTelemetry();
  public optOut = false;
  public learned: Facts = {};

  protected override createTelemetry(_deps: TelemetryDeps): Telemetry {
    this.recorder.enabled = !this.optOut;
    return this.recorder as unknown as Telemetry;
  }

  protected override describe(): Facts {
    return { ...super.describe(), ...this.learned };
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

  public async open(flags: Record<string, unknown> = {}): Promise<void> {
    await this.toMeta(flags, { source: "mock" });
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

  public note(patch: Facts): void {
    this.annotate(patch);
  }

  public watch(report: FlowReport): RunWatcher {
    return this.watchWizard(report);
  }
}

/** A flow whose only reported step settles a preset. */
const FLOW: FlowReport = {
  flow: "onboarding",
  otherwise: "application_setup",
  step: (key, known) => {
    return key === "pick"
      ? { step: "preset_selection", choice: known === undefined ? undefined : { preset: "email" } }
      : undefined;
  },
};

function makeCommand(): TestCommand {
  return new TestCommand([], aConfigAt("0.0.0-test"));
}

const names = (command: TestCommand): string[] => {
  return command.recorder.sent.map(({ event }) => event);
};

describe("Telemetered lifecycle", () => {
  it("fires started on open, then completed on emit, in order", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.complete();

    expect(names(cmd)).toEqual(["cli_command_started", "cli_command_completed"]);
  });

  it("fires started then failed when the command throws", async () => {
    const cmd = makeCommand();
    await cmd.open();
    await cmd.failWith(new Error("boom"));

    expect(names(cmd)).toEqual(["cli_command_started", "cli_command_failed"]);
    expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({
      status: "error",
      reason: "E_VALIDATION",
    });
  });

  it("records nothing when telemetry is opted out (inert)", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    cmd.complete();

    expect(names(cmd)).toEqual([]);
  });

  it("sends what the command noted and what it knows with its outcome", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.note({ framework: "next" });
    cmd.learned = { method: "passkey" };
    cmd.complete();

    expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({
      framework: "next",
      method: "passkey",
      status: "ok",
    });
  });

  it("sends the three lifecycle events to every destination", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.complete();

    expect(cmd.recorder.sent.map(({ only }) => only)).toEqual([undefined, undefined]);
  });
});

describe("Telemetered wizard flow", () => {
  it("reports the flow from its first step to its completion, with the choices made", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch(FLOW);

    watch.started?.("pick");
    watch.finished?.("pick", {});
    watch.completed?.();

    expect(names(cmd).slice(1)).toEqual(["flow_started", "step_completed", "flow_completed"]);
    expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({
      flow: "onboarding",
      preset: "email",
    });
  });

  it("sends flow events to Mixpanel only", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch(FLOW);

    watch.started?.("pick");

    expect(cmd.recorder.sent.at(-1)).toMatchObject({
      event: "flow_started",
      only: ["mixpanel"],
    });
  });

  it("reports a failure under the step that failed, with its error code, and nothing after", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch(FLOW);

    watch.started?.("pick");
    watch.failed?.("pick", new ZitadelError("E_NETWORK", "offline"));
    watch.completed?.();

    const failed = cmd.recorder.sent.filter(({ event }) => event === "flow_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.properties).toMatchObject({
      step: "preset_selection",
      reason: "E_NETWORK",
    });
    expect(names(cmd)).not.toContain("flow_completed");
  });

  it("reports a failure of a step the flow does not name under the fallback step", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch(FLOW);

    watch.started?.("install");
    watch.failed?.("install", new Error("no"));

    expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({ step: "application_setup" });
  });

  it("never completes a wizard that ended early", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch(FLOW);

    watch.started?.("pick");
    watch.ended?.("pick");
    watch.completed?.();

    expect(names(cmd)).not.toContain("flow_completed");
  });

  it("never completes a dry run", async () => {
    const cmd = makeCommand();
    await cmd.open({ dryRun: true });
    const watch = cmd.watch(FLOW);

    watch.started?.("pick");
    watch.completed?.();

    expect(names(cmd)).not.toContain("flow_completed");
  });

  it("carries a choice with no step name onto the flow's ending without a step event", async () => {
    const cmd = makeCommand();
    await cmd.open();
    const watch = cmd.watch({
      flow: "oidc_provider_setup",
      step: (key, known) => {
        return key === "selection" && known !== undefined
          ? { choice: { provider_type: "google" } }
          : undefined;
      },
    });

    watch.started?.("selection");
    watch.finished?.("selection", {});
    watch.completed?.();

    expect(names(cmd)).not.toContain("step_completed");
    expect(cmd.recorder.sent.at(-1)?.properties).toMatchObject({ provider_type: "google" });
  });
});
