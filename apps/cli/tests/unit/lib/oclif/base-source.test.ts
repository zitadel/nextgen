import { Config } from "@oclif/core";
import { describe, expect, it, vi } from "vitest";

import { BaseCommand } from "@/lib/oclif/base";
import { CLI_COMMAND_STARTED } from "@/lib/oclif/command-telemetry";
import type { JsonEnvelope } from "@/lib/oclif/types";
import type { Properties, Telemetry, TelemetryDeps } from "@/lib/telemetry";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { onTerminalReadingAFile } from "@tests/helpers/terminal";

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

  protected override async sourceOf(): Promise<string> {
    return "http://localhost:8080";
  }

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
});

/** A command that answers with whether this run's output is coloured. */
class Coloured extends BaseCommand {
  public static override readonly id = "coloured-test";

  public static override meta = {
    resolveServer: false,
  };

  public answer: boolean | undefined;

  // `jsonEnabled` is not overridden: `--json` is one of the things that
  // decides colour, so a double that answered it for itself would hide that.
  public override log(): void {
    /* swallow human output */
  }

  public override logJson(): void {
    /* swallow the envelope */
  }

  protected async execute(): Promise<JsonEnvelope> {
    this.answer = this.isColored;
    return this.emit({
      status: "ok",
      data: {},
    });
  }
}

/**
 * Every answer the run gives about colour. Colour itself cannot be asserted
 * through the CLI: picocolors and consola decide it when they load, from the
 * real process streams, so a run in a test never emits an escape byte whatever
 * the flags say. What the run decides is the thing worth pinning, and
 * `biome-plugins/no-own-colour.grit` keeps a command from deciding its own.
 */
describe("whether a run's output is coloured", () => {
  it.each([
    ["on a terminal", [], { TERM: "xterm" }, true],
    ["for --no-color", ["--no-color"], { TERM: "xterm" }, false],
    ["for NO_COLOR", [], { TERM: "xterm", NO_COLOR: "1" }, false],
    ["for NO_COLOR over FORCE_COLOR", [], { NO_COLOR: "1", FORCE_COLOR: "1" }, false],
    ["for --no-color over FORCE_COLOR", ["--no-color"], { FORCE_COLOR: "1" }, false],
    ["for FORCE_COLOR off a terminal", [], { FORCE_COLOR: "1" }, true],
    ["on a dumb terminal", [], { TERM: "dumb" }, false],
    ["for --json, which carries no colour", ["--json"], { TERM: "xterm" }, false],
  ])("is %s", async (_case, argv, env, expected) => {
    for (const [name, value] of Object.entries({
      TERM: "",
      NO_COLOR: "",
      FORCE_COLOR: "",
      ...env,
    })) {
      vi.stubEnv(name, value);
    }
    const coloured = new Coloured(["--no-telemetry", ...argv], config);

    await onTerminalReadingAFile(() => {
      return coloured.run();
    });

    expect(coloured.answer).toBe(expected);
  });
});
