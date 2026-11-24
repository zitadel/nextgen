import { describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { RunContext } from "@/cli/core/run-context";
import { RunTelemetry } from "@/cli/core/run-telemetry";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";

/** A client that records what it is sent. */
class Recording {
  /** Every event sent, with its properties. */
  readonly sent: { event: string; properties: Record<string, unknown> }[] = [];

  /** Whether the client sends anything. */
  readonly enabled: boolean;

  /** Whether this is the first run, which writes the device profile. */
  readonly isFirstRun: boolean;

  /** The id the client says it is. */
  readonly distinctId = "did-test";

  /** Whether the client was flushed. */
  flushed = false;

  /**
   * @param enabled - Whether the client sends anything.
   * @param isFirstRun - Whether this is the first run.
   */
  constructor(enabled = true, isFirstRun = false) {
    this.enabled = enabled;
    this.isFirstRun = isFirstRun;
  }

  /**
   * Records an event.
   *
   * @param event - The event.
   * @param properties - What it carries.
   */
  track(event: string, properties: Record<string, unknown> = {}): void {
    this.sent.push({ event, properties });
  }

  /** Records that a profile was written. */
  profile(): void {
    this.sent.push({ event: "profile", properties: {} });
  }

  /** Records that the client was flushed. */
  async shutdown(): Promise<void> {
    this.flushed = true;
  }
}

/**
 * A run's telemetry over a recording client.
 *
 * @param client - The client it creates.
 * @returns The telemetry and what it was asked to create the client from.
 */
function aTelemetry(client: Recording) {
  const created: TelemetryDeps[] = [];
  const telemetry = new RunTelemetry((deps) => {
    created.push(deps);

    return client as unknown as Telemetry;
  });

  return { telemetry, created };
}

const META = RunContext.fallback("1.2.3");

describe("RunTelemetry", () => {
  it("creates the client once and fires started", () => {
    const client = new Recording();
    const { telemetry, created } = aTelemetry(client);

    telemetry.open(META, undefined, false);
    telemetry.open(META, undefined, false);

    expect(created).toHaveLength(1);
    expect(client.sent.map(({ event }) => event)).toEqual(["cli_command_started"]);
  });

  it("hands the client the flag, so an opt-out is decided where consent is", () => {
    const { telemetry, created } = aTelemetry(new Recording());

    telemetry.open(META, false, false);

    expect(created[0]?.flag).toBe(false);
  });

  it("sends nothing when the client is disabled", () => {
    const client = new Recording(false);
    const { telemetry } = aTelemetry(client);

    telemetry.open(META, undefined, false);
    telemetry.completed(META, "ok");
    telemetry.failed(META, new ZitadelError("E_VALIDATION", "no"));

    expect(client.sent).toEqual([]);
  });

  it("carries recorded dimensions on completed and failed, not on started", () => {
    const client = new Recording();
    const { telemetry } = aTelemetry(client);

    telemetry.open(META, undefined, false);
    telemetry.record({ framework: "next" });
    telemetry.completed(META, "ok");
    telemetry.failed(META, new ZitadelError("E_VALIDATION", "no"));

    const [started, completed, failed] = client.sent;
    expect(started?.properties).not.toHaveProperty("framework");
    expect(completed?.properties).toMatchObject({ framework: "next", status: "ok" });
    expect(failed?.properties).toMatchObject({
      framework: "next",
      status: "error",
      reason: "E_VALIDATION",
    });
  });

  it("replaces what it recorded and never changes an event already sent", () => {
    const client = new Recording();
    const { telemetry } = aTelemetry(client);
    telemetry.open(META, undefined, false);
    telemetry.record({ step: "a" });
    telemetry.completed(META, "ok");

    telemetry.record({ step: "b" });
    telemetry.completed(META, "ok");

    const [, first, second] = client.sent;
    expect(first?.properties).toMatchObject({ step: "a" });
    expect(second?.properties).toMatchObject({ step: "b" });
  });

  it("tells a person about analytics once, on a first run at a terminal", () => {
    const client = new Recording(true, true);
    const { telemetry } = aTelemetry(client);

    telemetry.open(META, undefined, false);

    expect(client.sent.map(({ event }) => event)).toEqual(["cli_command_started", "profile"]);
  });

  it("flushes on shutdown", async () => {
    const client = new Recording(false);
    const { telemetry } = aTelemetry(client);
    telemetry.open(META, undefined, false);

    await telemetry.shutdown();

    expect(client.flushed).toBe(true);
  });
});
