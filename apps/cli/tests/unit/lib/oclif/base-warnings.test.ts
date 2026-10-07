import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";
import { reportWarning, takeReportedWarnings } from "../../../../src/lib/warnings";

/** A command that records what `emit` prints instead of writing it. */
class WarningCommand extends BaseCommand {
  public static override readonly id = "warnings-test";
  public readonly printed: string[] = [];

  public override jsonEnabled(): boolean {
    return false;
  }
  public override log(message?: string): void {
    this.printed.push(message ?? "");
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    return this.emit(result);
  }
}

function makeCommand(): WarningCommand {
  takeReportedWarnings();
  return new WarningCommand([], { version: "0.0.0-test" } as unknown as Config);
}

describe("BaseCommand warnings", () => {
  it("prints a result's warnings after its own terminal text", async () => {
    const cmd = makeCommand();

    await cmd.finish({ status: "ok", data: {}, warnings: ["careful"], pretty: "Done" });

    expect(cmd.printed).toEqual(["Done\nWarning: careful"]);
  });

  it("prints the warnings alone when the terminal text is empty", async () => {
    const cmd = makeCommand();

    await cmd.finish({ status: "ok", data: {}, warnings: ["careful"], pretty: "" });

    expect(cmd.printed).toEqual(["Warning: careful"]);
  });

  it("carries a reported warning into the envelope", async () => {
    const cmd = makeCommand();
    reportWarning("reported early");

    const envelope = await cmd.finish({ status: "ok", data: {}, warnings: ["from result"] });

    expect(envelope).toMatchObject({ warnings: ["reported early", "from result"] });
  });

  it("does not print a reported warning a second time", async () => {
    const cmd = makeCommand();
    reportWarning("reported early");

    await cmd.finish({ status: "ok", data: {}, pretty: "Done" });

    expect(cmd.printed).toEqual(["Done"]);
  });
});
