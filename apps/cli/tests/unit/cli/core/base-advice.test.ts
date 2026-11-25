import { describe, expect, it } from "vitest";

import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { LOCAL_SERVER_ADVICE, type LocalServerAdvice } from "@/lib/suggestion/local-server-advice";
import { Spelling } from "@/lib/suggestion/spelling";
import {
  LocalServerAdminError,
  LocalServerBinaryError,
  LocalServerBusyError,
  type LocalServerAdviceKey,
  LocalServerDockerMissingError,
  LocalServerDownError,
  type LocalServerError,
  LocalServerFileError,
  LocalServerMalformedError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerStartError,
  LocalServerStopError,
} from "@/lib/server";
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

  public async failWith(error: Error): Promise<void> {
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

const FAILURES: Record<LocalServerAdviceKey, () => LocalServerError> = {
  "not-running": () => {
    return new LocalServerDownError("not-running", { fact: 1 });
  },
  "not-responding": () => {
    return new LocalServerDownError("not-responding", { fact: 1 });
  },
  "file-unreadable": () => {
    return new LocalServerFileError("unreadable", "It failed", { details: { fact: 1 } });
  },
  "file-blocked": () => {
    return new LocalServerFileError("blocked", "It failed", { details: { fact: 1 } });
  },
  "record-malformed": () => {
    return new LocalServerMalformedError("record", "It failed", { details: { fact: 1 } });
  },
  "admin-malformed": () => {
    return new LocalServerMalformedError("admin", "It failed", { details: { fact: 1 } });
  },
  "admin-not-found": () => {
    return new LocalServerAdminError("rejected", "It failed", { details: { fact: 1 } });
  },
  "package-missing": () => {
    return new LocalServerBinaryError("missing", "It failed", { details: { fact: 1 } });
  },
  "cannot-launch": () => {
    return new LocalServerBinaryError("blocked", "It failed", { details: { fact: 1 } });
  },
  "start-in-progress": () => {
    return new LocalServerBusyError({ fact: 1 });
  },
  "session-exchange-failed": () => {
    return new LocalServerAdminError("session", "It failed", { details: { fact: 1 } });
  },
  "platform-missing": () => {
    return new LocalServerAdminError("platform-missing", "It failed", { details: { fact: 1 } });
  },
  "processes-did-not-stop": () => {
    return new LocalServerStopError("processes", "It failed", { details: { fact: 1 } });
  },
  "docker-unavailable": () => {
    return new LocalServerDockerMissingError("no daemon");
  },
  "no-free-port": () => {
    return new LocalServerPortFullError(8080, 8179);
  },
  "port-in-use": () => {
    return new LocalServerPortBusyError(8080);
  },
  "server-did-not-start": () => {
    return new LocalServerStartError(
      "timeout",
      { port: 1, server_url: "http://x" },
      { status: "stopped" },
      { fact: 1 },
    );
  },
  "processes-unlistable": () => {
    return new LocalServerStopError("unlistable", "It failed", { details: { fact: 1 } });
  },
  "server-did-not-stop": () => {
    return new LocalServerStopError("server", "It failed", { details: { fact: 1 } });
  },
};

const KINDS = Object.keys(LOCAL_SERVER_ADVICE) as LocalServerAdviceKey[];

describe("BaseCommand advice for failures of the local server", () => {
  it.each(KINDS)("adds the advice for a %s failure of the local server", async (kind) => {
    const command = new Failing([], aConfigAt(VERSION));

    const failure = FAILURES[kind]();

    expect(failure.advice).toBe(kind);
    await command.failWith(failure);

    expect(command.json).toEqual([
      expect.objectContaining({
        status: "error",
        message: failure.message,
        hint: publicHint(LOCAL_SERVER_ADVICE[kind].hint),
      }),
    ]);
  });

  it("leaves a failure that is not the local server's as it was", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(new Error("something else"));

    expect(command.json).toEqual([
      expect.objectContaining({ status: "error", message: "something else" }),
    ]);
  });

  it("names the file a failure is about in its hint", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(
      new LocalServerFileError("unreadable", "It failed", { details: { path: "/p/admin.json" } }),
    );

    expect(command.json).toEqual([
      expect.objectContaining({ hint: expect.stringContaining("Check that /p/admin.json and") }),
    ]);
  });

  it("aims the recovery of a malformed record at the folder that holds it", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(
      new LocalServerMalformedError("record", "It failed", { details: { directory: "/parent" } }),
    );

    expect(JSON.stringify(command.json)).toContain("--cwd /parent");
  });

  it("removes a malformed admin file before it resets", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(
      new LocalServerMalformedError("admin", "It failed", { details: { path: "/p/admin.json" } }),
    );

    expect(JSON.stringify(command.json)).toContain("rm /p/admin.json");
  });

  it("quotes the admin file it asks to remove when its path has a space", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(
      new LocalServerMalformedError("admin", "It failed", {
        details: { path: "/my dir/admin.json" },
      }),
    );

    expect(JSON.stringify(command.json)).toContain("rm '/my dir/admin.json'");
  });

  it("hands over the retargeted arguments when the record is in another folder", async () => {
    const command = new Failing([], aConfigAt(VERSION));

    await command.failWith(
      new LocalServerMalformedError("record", "It failed", { details: { directory: "/my dir" } }),
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

    await command.failWith(
      new LocalServerBinaryError("missing", "It failed", { details: { directory: "/elsewhere" } }),
    );

    expect(command.json).toEqual([expect.objectContaining({ status: "error" })]);
    expect(JSON.stringify(command.json)).toContain("npm");
  });

  it.each(["admin-not-found", "session-exchange-failed"] as const)(
    "never has an agent run a reset for a %s failure",
    (kind) => {
      const advice: LocalServerAdvice = LOCAL_SERVER_ADVICE[kind];

      expect(
        (advice.next ?? []).filter((step) => {
          return typeof step === "object" && (step as { id?: string }).id === "reset";
        }),
      ).toEqual([]);
    },
  );
});
