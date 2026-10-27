import type { Config } from "@oclif/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { intro, outro } from "@clack/prompts";

import { ZitadelError } from "../../../../src/lib/errors";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import { asTerminal } from "../../../helpers/terminal";

/** A command that fails with a given error and records what it prints. */
class FailingCommand extends BaseCommand {
  public static override readonly id = "errors-test";
  public readonly stderr: string[] = [];
  declare public ui: BaseCommand["ui"];
  public readonly json: unknown[] = [];
  public exitCode: number | undefined;
  private readonly asJson: boolean;

  constructor(asJson: boolean) {
    super([], { version: "0.0.0-test" } as unknown as Config);
    this.asJson = asJson;
  }

  public override jsonEnabled(): boolean {
    return this.asJson;
  }
  public override logToStderr(message?: string): void {
    this.stderr.push(message ?? "");
  }
  public override logJson(json: unknown): void {
    this.json.push(json);
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  private prepared = false;

  /**
   * Builds the UI the way a real run does, once. A second `toMeta` would
   * build a second `Ui` and throw away the chain the first one opened.
   */
  public async open(): Promise<void> {
    if (this.prepared) {
      return;
    }
    this.prepared = true;
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
  }

  public async fail(error: Error): Promise<void> {
    await this.open();
    try {
      await this.catch(error);
    } catch (exit) {
      // catch() ends by throwing oclif's ExitError, which carries the code.
      this.exitCode = (exit as { oclif?: { exit?: number } }).oclif?.exit;
    }
  }
}

describe("BaseCommand errors", () => {
  it("prints the error block for a failure", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_VALIDATION", "Bad port", { hint: "Use 1 to 65535." }));

    expect(cmd.stderr).toEqual(["Error E_VALIDATION: Bad port\nUse 1 to 65535."]);
  });

  it("prints nothing for Ctrl-C, which the terminal already shows, and still exits 130", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(cmd.stderr).toEqual([]);
    expect(cmd.exitCode).toBe(130);
  });

  it("still answers --json with the envelope for Ctrl-C", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(cmd.json).toEqual([expect.objectContaining({ code: "E_CANCELLED" })]);
  });
});

// Ctrl-C closes nothing by itself. Without `catch` telling the chain to stop,
// an interrupted run ends on a bare opening line and the shell prompt is
// drawn inside the gutter.
describe("BaseCommand on an interrupted run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes a chain the interrupt left open", async () => {
    const cmd = new FailingCommand(false);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await asTerminal(async () => {
      await cmd.open();
      cmd.ui.say("something happened");
      await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled"));
    });

    expect(intro).toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
    vi.restoreAllMocks();
  });

  it("closes nothing when the interrupt arrived before anything was drawn", async () => {
    const cmd = new FailingCommand(false);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await asTerminal(async () => {
      await cmd.open();
      await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled"));
    });

    expect(outro).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
