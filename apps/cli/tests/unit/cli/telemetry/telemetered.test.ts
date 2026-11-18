import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FlowReport, Telemetered } from "@/cli/telemetry/telemetered";
import { ZitadelError } from "@/lib/errors";
import { BaseCommand, type Facts } from "@/lib/oclif/base";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";
import { loadOrCreateIdentity, markNoticed, type StoredIdentity } from "@/lib/telemetry/identity";
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
  /** Events and the first-run notice, in the order they happened. */
  public readonly order: string[] = [];
  public shutdowns = 0;
  public readonly profiles: { set: Record<string, unknown>; once: Record<string, unknown> }[] = [];
  public enabled = true;
  public isFirstRun = false;
  public record: StoredIdentity | undefined;
  public readonly distinctId = "did-test";

  public track(
    event: string,
    properties: Record<string, unknown> = {},
    only?: readonly string[],
  ): void {
    this.sent.push({ event, properties, only });
    this.order.push(event);
  }

  public profile(
    set: Record<string, unknown>,
    _modifiers: unknown,
    once: Record<string, unknown>,
  ): void {
    this.profiles.push({ set, once });
  }

  public async shutdown(): Promise<void> {
    this.shutdowns += 1;
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
  /** Whether a person is at the terminal, answering what the run would. */
  public interactive = false;
  public watchdogs = 0;
  /** Whether the install's record is one an earlier release created. */
  public olderInstall = false;

  protected override createTelemetry(deps: TelemetryDeps): Telemetry {
    this.recorder.enabled = deps.flag !== false && !this.optOut;
    this.recorder.record = this.olderInstall
      ? { distinctId: "an-earlier-install" }
      : loadOrCreateIdentity(deps.env).record;
    return this.recorder as unknown as Telemetry;
  }

  protected override get nonInteractive(): boolean {
    return !this.interactive;
  }

  protected override get isTTY(): boolean {
    return this.interactive;
  }

  public override logToStderr(): void {
    this.recorder.order.push("notice");
  }

  protected override armExitWatchdog(): void {
    this.watchdogs += 1;
  }

  public send(event: string, properties: Facts): void {
    this.trackEvent(event, properties);
  }

  public async wrapUp(): Promise<void> {
    await this.finally(undefined);
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

/** Where the install's id and profile record live, so a test never touches the real one. */
const config = { dir: "" };

beforeEach(() => {
  config.dir = mkdtempSync(join(tmpdir(), "zitadel-telemetered-"));
  vi.stubEnv("XDG_CONFIG_HOME", config.dir);
  // The real client mints the install's id before the mixin asks about its profile.
  loadOrCreateIdentity({ XDG_CONFIG_HOME: config.dir });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(config.dir, { recursive: true, force: true });
});

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

describe("Telemetered first-run notice", () => {
  it("shows the notice to a person at a terminal before the first event is sent", async () => {
    const cmd = makeCommand();
    cmd.recorder.isFirstRun = true;
    cmd.interactive = true;
    await cmd.open();

    expect(cmd.recorder.order.slice(0, 2)).toEqual(["notice", "cli_command_started"]);
  });

  it("does not show it to a run that cannot ask", async () => {
    const cmd = makeCommand();
    cmd.recorder.isFirstRun = true;
    await cmd.open();

    expect(cmd.recorder.order).not.toContain("notice");
  });

  it("remembers that it was shown, so no later run shows it", async () => {
    const cmd = makeCommand();
    cmd.recorder.isFirstRun = true;
    cmd.interactive = true;
    await cmd.open();

    expect(loadOrCreateIdentity({ XDG_CONFIG_HOME: config.dir }).isFirstRun).toBe(false);
  });

  it("does not show it to a run that lost the claim to a concurrent first run", async () => {
    markNoticed({ XDG_CONFIG_HOME: config.dir });
    const cmd = makeCommand();
    cmd.recorder.isFirstRun = true;
    cmd.interactive = true;
    await cmd.open();

    expect(cmd.recorder.order).not.toContain("notice");
  });

  it("leaves it for a later run when the first run could not show it", async () => {
    const cmd = makeCommand();
    cmd.recorder.isFirstRun = true;
    await cmd.open();

    expect(loadOrCreateIdentity({ XDG_CONFIG_HOME: config.dir }).isFirstRun).toBe(true);
  });
});

describe("Telemetered run that fails early", () => {
  it("reports a failure before the context was settled", async () => {
    const cmd = makeCommand();
    await cmd.failWith(new Error("boom"));

    expect(names(cmd)).toEqual(["cli_command_started", "cli_command_failed"]);
  });

  it("sends nothing when --no-telemetry is on the command line", async () => {
    const argv = process.argv;
    process.argv = [...argv, "--no-telemetry"];
    try {
      const cmd = makeCommand();
      await cmd.failWith(new Error("boom"));

      expect(names(cmd)).toEqual([]);
    } finally {
      process.argv = argv;
    }
  });
});

describe("Telemetered end of run", () => {
  it("flushes what is unsent and arms the exit watchdog", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.complete();
    await cmd.wrapUp();

    expect([cmd.recorder.shutdowns, cmd.watchdogs]).toEqual([1, 1]);
  });

  it("arms no watchdog for a run that sent nothing", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    await cmd.wrapUp();

    expect(cmd.watchdogs).toBe(0);
  });
});

describe("Telemetered product events", () => {
  it("sends a product event with its properties and the command's context", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.send("invitation_created", { role: "project_viewer", invitation_journey_id: "journey_1" });

    expect(names(cmd)).toEqual(["cli_command_started", "invitation_created"]);
    expect(cmd.recorder.sent[1]?.properties).toMatchObject({
      role: "project_viewer",
      invitation_journey_id: "journey_1",
      command: "telemetry-test",
      invocation_id: cmd.recorder.sent[0]?.properties.invocation_id,
    });
  });

  it("sends a product event to every destination", async () => {
    const cmd = makeCommand();
    await cmd.open();
    cmd.send("invitation_created", { role: "project_viewer" });

    expect(cmd.recorder.sent[1]?.only).toBeUndefined();
  });

  it("sends no product event when telemetry is opted out", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();
    cmd.send("invitation_created", { role: "project_viewer" });

    expect(names(cmd)).toEqual([]);
  });
});

describe("Telemetered profile", () => {
  it("writes the install's profile on the first run, with its first version written once", async () => {
    const cmd = makeCommand();
    await cmd.open();

    expect(cmd.recorder.profiles).toHaveLength(1);
    expect(cmd.recorder.profiles[0]?.set).toMatchObject({ cli_version: "0.0.0-test" });
    expect(cmd.recorder.profiles[0]?.once).toEqual({ first_cli_version: "0.0.0-test" });
  });

  it("leaves the first version unwritten for an install that predates it", async () => {
    const cmd = makeCommand();
    cmd.olderInstall = true;
    await cmd.open();

    expect(cmd.recorder.profiles[0]?.once).toEqual({});
  });

  it("does not write it again on the next run while nothing changed", async () => {
    await makeCommand().open();
    const next = makeCommand();
    await next.open();

    expect(next.recorder.profiles).toHaveLength(0);
  });

  it("writes nothing for a run that is opted out", async () => {
    const cmd = makeCommand();
    cmd.optOut = true;
    await cmd.open();

    expect(cmd.recorder.profiles).toHaveLength(0);
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
