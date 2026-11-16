import { describe, expect, it } from "vitest";

import { BaseCommand } from "@/lib/oclif/base";
import { aConfigAt } from "@tests/helpers/suggestions";
import { prose, rows } from "@/lib/oclif/rendering";
import type { CommandResult, JsonEnvelope } from "@/lib/oclif/types";
import { reportWarning, takeReportedWarnings } from "@/lib/warnings";
import { offTerminal } from "@tests/helpers/terminal";

/** A command that records what `emit` prints instead of writing it. */
class WarningCommand extends BaseCommand {
  public static override readonly id = "warnings-test";
  public readonly printed: string[] = [];
  public readonly aside: string[] = [];

  public override jsonEnabled(): boolean {
    return false;
  }
  public override log(message?: string): void {
    this.printed.push(message ?? "");
  }
  public override logToStderr(message?: string): void {
    this.aside.push(message ?? "");
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async fail(error: Error): Promise<void> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    try {
      await this.catch(error);
    } catch {
      /* catch() ends by throwing oclif's ExitError */
    }
  }

  public override logJson(json: unknown): void {
    this.json.push(json);
  }
  public readonly json: unknown[] = [];

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    return this.emit(result);
  }
}

function makeCommand(): WarningCommand {
  takeReportedWarnings();
  return new WarningCommand([], aConfigAt("0.0.0-test"));
}

describe("BaseCommand warnings", () => {
  it("prints a result's warnings after its own terminal text", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      warnings: ["careful"],
      pretty: prose("Done"),
    });

    expect(cmd.printed).toEqual(["Done\nWarning: careful"]);
  });

  it("prints the warnings alone when the terminal text is empty", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      warnings: ["careful"],
      pretty: prose(""),
    });

    expect(cmd.printed).toEqual(["Warning: careful"]);
  });

  it("spells out a warning beside a command's own rendering, which names what the server answered", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      warnings: ["schema \u001b[2Jwiped has no identifier"],
      pretty: prose("Deployed"),
    });

    expect(cmd.printed.join("\n")).not.toContain("\u001b");
    expect(cmd.printed).toEqual(["Deployed\nWarning: schema \\x1b[2Jwiped has no identifier"]);
  });

  it("keeps a warning and the footer off the stdout a script reads", async () => {
    const cmd = makeCommand();

    await offTerminal(() => {
      return cmd.finish({
        summary: { title: "Done", sections: [] },
        status: "ok",
        data: {},
        warnings: ["careful"],
        pretty: rows("row"),
        footer: "See also",
      });
    });

    expect(cmd.printed).toEqual(["row"]);
    expect(cmd.aside).toEqual(["Warning: careful", "\nSee also"]);
  });

  it("carries a reported warning into the envelope", async () => {
    const cmd = makeCommand();
    reportWarning("reported early");

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      warnings: ["from result"],
    });

    expect(envelope).toMatchObject({ warnings: ["reported early", "from result"] });
  });

  it("does not print a reported warning a second time", async () => {
    const cmd = makeCommand();
    reportWarning("reported early");

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      pretty: prose("Done"),
    });

    expect(cmd.printed).toEqual(["Done"]);
  });

  it("carries a reported warning into a skipped envelope", async () => {
    const cmd = makeCommand();
    reportWarning("reported early");

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "skipped",
      reason: "dry-run",
    });

    expect(envelope).toMatchObject({ status: "skipped", warnings: ["reported early"] });
  });

  it("leaves a skipped envelope without warnings when none were reported", async () => {
    const cmd = makeCommand();

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "skipped",
      reason: "dry-run",
    });

    expect(envelope).not.toHaveProperty("warnings");
  });

  it("carries a reported warning into an error envelope", async () => {
    const cmd = makeCommand();
    cmd.jsonEnabled = () => true;
    reportWarning("reported early");

    await cmd.fail(new Error("boom"));

    expect(cmd.json).toEqual([
      expect.objectContaining({ status: "error", warnings: ["reported early"] }),
    ]);
  });
});
