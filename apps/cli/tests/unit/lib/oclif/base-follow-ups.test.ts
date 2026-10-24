import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";

/** A command run with or without `--json`, recording what it prints instead of writing it. */
class FollowUpCommand extends BaseCommand {
  public static override readonly id = "follow-ups-test";
  public asJson = false;
  public readonly printed: string[] = [];
  public readonly envelopes: unknown[] = [];

  public override jsonEnabled(): boolean {
    return this.asJson;
  }
  public override log(message?: string): void {
    this.printed.push(message ?? "");
  }
  public override logToStderr(message?: string): void {
    this.printed.push(message ?? "");
  }
  public override logJson(json: unknown): void {
    this.envelopes.push(json);
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ telemetry: false }, { resolveServer: false, source: "mock" });
    return this.emit(result);
  }

  public async fail(error: Error): Promise<void> {
    await this.toMeta({ telemetry: false }, { resolveServer: false, source: "mock" });
    try {
      await this.catch(error);
    } catch {
      /* catch() ends by throwing oclif's ExitError */
    }
  }
}

function aCommand({ json }: { json: boolean }): FollowUpCommand {
  const cmd = new FollowUpCommand([], { version: "0.1.0" } as unknown as Config);
  cmd.asJson = json;
  return cmd;
}

const refusal = () =>
  new ZitadelError("E_VALIDATION", "Refused", {
    nextCommands: ["zitadel start", "docker version"],
    details: { suggested_args: [["reset", "--force", "--cwd", "/home/dev/my app"]] },
  });

describe("BaseCommand follow-ups", () => {
  describe("--json", () => {
    it("asks for JSON in a result's next_commands and next_args", async () => {
      const cmd = aCommand({ json: true });

      const envelope = await cmd.finish({
        status: "ok",
        data: { next_commands: ["zitadel plan", "npm run dev"], next_args: [["apply"]] },
      });

      expect(envelope).toMatchObject({
        data: {
          next_commands: ["npx @zitadel/cli@0.1.0 plan --json", "npm run dev"],
          next_args: [["apply", "--json"]],
        },
      });
    });

    it("asks for JSON in a skip's next_commands", async () => {
      const cmd = aCommand({ json: true });

      const envelope = await cmd.finish({
        status: "skipped",
        reason: "already-initialized",
        nextCommands: ["zitadel doctor"],
      });

      expect(envelope).toMatchObject({ next_commands: ["npx @zitadel/cli@0.1.0 doctor --json"] });
    });

    it("asks for JSON in a failure's next_commands and suggested_args", async () => {
      const cmd = aCommand({ json: true });

      await cmd.fail(refusal());

      expect(cmd.envelopes).toEqual([
        expect.objectContaining({
          next_commands: ["npx @zitadel/cli@0.1.0 start --json", "docker version"],
          details: {
            suggested_args: [["reset", "--force", "--cwd", "/home/dev/my app", "--json"]],
          },
        }),
      ]);
    });
  });

  describe("rendered for a terminal", () => {
    it("prints a skip's follow-ups as they are", async () => {
      const cmd = aCommand({ json: false });

      await cmd.finish({
        status: "skipped",
        reason: "already-initialized",
        nextCommands: ["zitadel doctor"],
      });

      expect(cmd.printed).toEqual([
        "Skipped: already-initialized\nNext:\n  $ npx @zitadel/cli@0.1.0 doctor",
      ]);
    });

    it("prints a failure's follow-ups as they are", async () => {
      const cmd = aCommand({ json: false });

      await cmd.fail(refusal());

      expect(cmd.printed).toEqual([
        "Error E_VALIDATION: Refused\nNext:\n  $ npx @zitadel/cli@0.1.0 start\n  $ docker version",
      ]);
    });
  });
});
