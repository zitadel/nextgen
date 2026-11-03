import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import { CLI_COMMAND_STARTED } from "../../../../src/lib/oclif/command-telemetry";
import type { JsonEnvelope } from "../../../../src/lib/oclif/types";
import type { Properties, Telemetry, TelemetryDeps } from "../../../../src/lib/telemetry";
import { cliPackageRoot } from "../../../helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

/** Records what each event was reported with. */
class RecordingTelemetry {
  public readonly reported: { event: string; properties: Properties }[] = [];
  public enabled = true;
  public readonly isFirstRun = false;
  public readonly distinctId = "did-test";

  public track(event: string, properties: Properties = {}): void {
    this.reported.push({ event, properties });
  }

  public profile(): void {
    /* no profile in this harness */
  }

  public async shutdown(): Promise<void> {
    /* no pending sends in tests */
  }
}

/**
 * A command that knows its server before it does any work, as every
 * local-runtime command does. The run's context is built before `execute`, and
 * building it opens telemetry, so a server worked out inside `execute` reaches
 * the first event too late.
 */
class Sourced extends BaseCommand {
  public static override readonly id = "sourced-test";
  public readonly recorder = new RecordingTelemetry();

  public static override meta = {
    resolveServer: false,
  };

  protected override createTelemetry(_deps: TelemetryDeps): Telemetry {
    return this.recorder as unknown as Telemetry;
  }

  public override jsonEnabled(): boolean {
    return false;
  }

  public override log(): void {
    /* swallow human output */
  }

  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    this.asked = cwd;
    return "http://localhost:8080";
  }

  public asked: string | undefined;

  protected async execute(): Promise<JsonEnvelope> {
    return this.emit({
      status: "ok",
      data: {},
    });
  }
}

describe("the server a run is about", () => {
  it("is named on the first event, not only once the command has worked it out", async () => {
    const command = new Sourced([], config);

    await command.run();

    expect(command.recorder.reported[0]?.event).toBe(CLI_COMMAND_STARTED);
    expect(command.recorder.reported[0]?.properties).toMatchObject({
      server_kind: "local",
    });
  });

  it("is resolved for the directory the run addresses, which is not set this early", async () => {
    const command = new Sourced(["--cwd", "/tmp"], config);

    await command.run();

    expect(command.asked).toBe("/tmp");
  });
});
