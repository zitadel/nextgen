import { describe, expect, it } from "vitest";

import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/lib/oclif";
import { LOCAL_SERVER_ADVICE } from "@/lib/suggestion/local-server-advice";
import { Spelling } from "@/lib/suggestion/spelling";
import { LocalServerError, type LocalServerErrorKind } from "@/lib/server";
import { aConfigAt } from "@tests/helpers/suggestions";

/** A local-server command that records the failure envelope it would print. */
class Failing extends LocalServerCommand(BaseCommand, "exact") {
  public static override readonly id = "failing-server-test";
  public readonly json: unknown[] = [];

  public override jsonEnabled(): boolean {
    return true;
  }

  public override logJson(json: unknown): void {
    this.json.push(json);
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async fail(error: Error): Promise<void> {
    await this.toMeta({ "no-telemetry": true }, { source: "mock" });
    try {
      await this.catch(error);
    } catch {
      /* catch() ends by throwing oclif's ExitError */
    }
  }
}

const VERSION = "0.0.0-test";

/** A hint as the reader sees it: each `zitadel …` command in public form. */
function publicHint(hint: string): string {
  return hint
    .replace(/`zitadel ([^`]*)`/g, (_match, args: string) => {
      return Spelling.at(VERSION).command(args);
    })
    .replaceAll("`", "");
}

const KINDS = Object.keys(LOCAL_SERVER_ADVICE) as LocalServerErrorKind[];

describe("BaseCommand advice for failures of the local server", () => {
  it.each(KINDS)("adds the advice for a %s failure of the local server", async (kind) => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(new LocalServerError(kind, "E_VALIDATION", "It failed", { fact: 1 }));

    expect(command.json).toEqual([
      expect.objectContaining({
        status: "error",
        message: "It failed",
        hint: publicHint(LOCAL_SERVER_ADVICE[kind].hint),
        details: { fact: 1 },
      }),
    ]);
  });

  it("leaves a failure that is not the local server's as it was", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(new Error("something else"));

    expect(command.json).toEqual([
      expect.objectContaining({ status: "error", message: "something else" }),
    ]);
  });

  it("names the file a failure is about in its hint", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("admin-unreadable", "E_VALIDATION", "It failed", {
        path: "/p/admin.json",
      }),
    );

    expect(command.json).toEqual([
      expect.objectContaining({ hint: expect.stringContaining("Check that /p/admin.json is") }),
    ]);
  });

  it("aims the recovery of a malformed record at the folder that holds it", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("record-malformed", "E_VALIDATION", "It failed", {
        directory: "/parent",
      }),
    );

    expect(JSON.stringify(command.json)).toContain("--cwd /parent");
  });

  it("removes a malformed admin file before it resets", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("admin-malformed", "E_VALIDATION", "It failed", {
        path: "/p/admin.json",
      }),
    );

    expect(JSON.stringify(command.json)).toContain("rm /p/admin.json");
  });

  it("quotes the admin file it asks to remove when its path has a space", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("admin-malformed", "E_VALIDATION", "It failed", {
        path: "/my dir/admin.json",
      }),
    );

    expect(JSON.stringify(command.json)).toContain("rm '/my dir/admin.json'");
  });

  it("hands over the retargeted arguments when the record is in another folder", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("record-malformed", "E_VALIDATION", "It failed", {
        directory: "/my dir",
      }),
    );

    expect(command.json).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          suggested_args: [
            ["reset", "--force", "--cwd", "/my dir"],
            ["start", "--cwd", "/my dir"],
          ],
        }),
      }),
    ]);
  });

  it("keeps a command written as text when the failure names another folder", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.fail(
      new LocalServerError("package-missing", "E_VALIDATION", "It failed", {
        directory: "/elsewhere",
      }),
    );

    expect(command.json).toEqual([expect.objectContaining({ status: "error" })]);
    expect(JSON.stringify(command.json)).toContain("npm");
  });

  it.each(["admin-not-found", "session-exchange-failed"] as const)(
    "never has an agent run a reset for a %s failure",
    (kind) => {
      const advice: { next?: readonly unknown[] } = LOCAL_SERVER_ADVICE[kind];

      expect(
        (advice.next ?? []).filter((step) => {
          return typeof step === "object" && (step as { id?: string }).id === "reset";
        }),
      ).toEqual([]);
    },
  );
});
