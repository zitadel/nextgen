import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import { asStepsShown } from "../../../../src/lib/oclif/next-steps";
import { asTerminal, offTerminal } from "../../../helpers/terminal";
import { publicCliCommand } from "../../../../src/lib/public-cli";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";
import { type SuggestedCommand, unscopedCommand } from "../../../../src/lib/suggestion";
import { takeReportedWarnings } from "../../../../src/lib/warnings";

/** A command that records what `emit` prints, per stream, instead of writing it. */
class NextStepsCommand extends BaseCommand {
  public static override readonly id = "next-steps-test";
  public readonly stdout: string[] = [];
  public readonly stderr: string[] = [];

  public override jsonEnabled(): boolean {
    return false;
  }
  public override log(message?: string): void {
    this.stdout.push(message ?? "");
  }
  public override logToStderr(message?: string): void {
    this.stderr.push(message ?? "");
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ telemetry: false }, { resolveServer: false, source: "mock" });
    return this.emit(result);
  }
}

function makeCommand(): NextStepsCommand {
  takeReportedWarnings();
  return new NextStepsCommand([], { version: "0.0.0-test" } as unknown as Config);
}

const DEPLOY: SuggestedCommand = unscopedCommand("deploy");
/** {@link DEPLOY} as the reader runs it. */
const PUBLIC_DEPLOY = publicCliCommand("deploy", "0.0.0-test");

describe("BaseCommand next steps", () => {
  describe("in the envelope", () => {
    it("writes them into an ok result's data", async () => {
      const envelope = await makeCommand().finish({
        status: "ok",
        data: { id: "1" },
        next: { actions: ["Publish it."], commands: [DEPLOY] },
      });

      expect(envelope).toMatchObject({
        data: {
          id: "1",
          next_actions: ["Publish it."],
          next_commands: [PUBLIC_DEPLOY],
        },
      });
    });

    it("keeps a list the command set empty", async () => {
      const envelope = await makeCommand().finish({
        status: "ok",
        data: {},
        next: { commands: [] },
      });

      expect(envelope).toMatchObject({ data: { next_commands: [] } });
    });

    it("leaves out a list the command did not set", async () => {
      const envelope = await makeCommand().finish({
        status: "ok",
        data: {},
        next: { commands: [DEPLOY] },
      });

      expect(envelope).not.toHaveProperty("data.next_actions");
    });

    it("leaves data that is not an object as it is", async () => {
      const envelope = await makeCommand().finish({
        status: "ok",
        data: "accepted",
        next: { commands: [DEPLOY] },
      });

      expect(envelope).toMatchObject({ data: "accepted" });
    });

    it("puts a skip's commands at the top level", async () => {
      const envelope = await makeCommand().finish({
        status: "skipped",
        reason: "nothing-to-do",
        next: { commands: [DEPLOY] },
      });

      expect(envelope).toMatchObject({ next_commands: [PUBLIC_DEPLOY] });
    });
  });

  describe("printed", () => {
    it("follows a command's own rendering", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "Deployed",
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual([`Deployed\n\nNext:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("follows a rendering that ends in a newline after one blank line", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "Deployed\n",
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual([`Deployed\n\nNext:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("comes before a command's warnings", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "Deployed",
        warnings: ["careful"],
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual([`Deployed\n\nNext:\n  $ ${PUBLIC_DEPLOY}\nWarning: careful`]);
    });

    it("follows the generic rendering after a blank line", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: { title: "Done." },
        next: { actions: ["Publish it."] },
      });

      expect(cmd.stdout.at(-1)).toMatch(/\n\nNext:\n {2}Publish it\.$/);
    });

    it("follows a skip's own rendering on the next line", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "skipped",
        reason: "not-live",
        pretty: "Nothing was removed",
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual([`Nothing was removed\nNext:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("follows a skip's reason", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "skipped",
        reason: "nothing-to-do",
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual([`Skipped: nothing-to-do\nNext:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("comes before the footer", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "Done",
        next: { commands: [DEPLOY] },
        footer: "See also",
      });

      expect(cmd.stdout.at(-1)).toBe("\nSee also");
    });

    it("leaves output a script reads as the only thing on stdout", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "row",
        machineReadable: true,
        next: { commands: [DEPLOY] },
      });

      expect(cmd.stdout).toEqual(["row"]);
    });

    it("goes to stderr beside output a script reads", async () => {
      const cmd = makeCommand();

      await offTerminal(() =>
        cmd.finish({
          status: "ok",
          data: {},
          pretty: "row",
          machineReadable: true,
          next: { commands: [DEPLOY] },
        }),
      );

      expect(cmd.stderr).toEqual([`Next:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("is set apart from output a script reads when both share a terminal", async () => {
      const cmd = makeCommand();

      await asTerminal(() =>
        cmd.finish({
          status: "ok",
          data: {},
          pretty: "{}",
          machineReadable: true,
          next: { commands: [DEPLOY] },
        }),
      );

      expect(cmd.stderr).toEqual([`\nNext:\n  $ ${PUBLIC_DEPLOY}`]);
    });

    it("is not repeated after output that already showed it", async () => {
      const cmd = makeCommand();

      await cmd.finish({
        status: "ok",
        data: {},
        pretty: "",
        next: { commands: [DEPLOY] },
        nextShown: asStepsShown(),
      });

      expect(cmd.stdout).toEqual([]);
    });

    it("prints nothing when there is nothing to do next", async () => {
      const cmd = makeCommand();

      await cmd.finish({ status: "ok", data: {}, pretty: "Done", next: { commands: [] } });

      expect(cmd.stdout).toEqual(["Done"]);
    });
  });
});
