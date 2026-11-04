import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CredentialUsed } from "../../../../src/lib/oclif/credentials";

/** A command that fails with a given error and records what it prints. */
class FailingCommand extends BaseCommand {
  public static override readonly id = "errors-test";
  public readonly stderr: string[] = [];
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

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /** Fails with `error`, having connected with `credential` first, as a project command does. */
  public async fail(error: Error, credential?: CredentialUsed): Promise<void> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    if (credential !== undefined) {
      this.meta = { ...this.meta, credential };
    }
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

  it("names the credential a command connected with in the error envelope", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_AUTH", "Permission denied"), "login");

    expect(cmd.json).toEqual([
      expect.objectContaining({ source: "mock", credential: "login", code: "E_AUTH" }),
    ]);
  });

  it("names no credential in the error envelope of a command that never connected", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_VALIDATION", "Bad port"));

    expect(cmd.json[0]).not.toHaveProperty("credential");
  });

  it("still answers --json with the envelope for Ctrl-C", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(cmd.json).toEqual([expect.objectContaining({ code: "E_CANCELLED" })]);
  });
});
