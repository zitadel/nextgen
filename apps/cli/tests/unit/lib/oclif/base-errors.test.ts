import type { Config } from "@oclif/core";
import { describe, expect, it, vi } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { unscopedCommand } from "@/lib/suggestion";
import { BaseCommand } from "@/lib/oclif/base";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { printing, stripAnsi } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";

/** A command that fails with a given error and records what it prints. */
class FailingCommand extends BaseCommand {
  public static override readonly id = "errors-test";
  public readonly stderr: string[] = [];
  declare public ui: BaseCommand["ui"];
  public readonly json: unknown[] = [];
  public exitCode: number | undefined;
  private readonly asJson: boolean;
  private readonly flags: Record<string, unknown>;

  constructor(asJson: boolean, argv: string[] = [], flags: Record<string, unknown> = {}) {
    super(argv, { version: "0.0.0-test" } as unknown as Config);
    this.asJson = asJson;
    this.flags = flags;
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
    await this.toMeta(
      { "no-telemetry": true, ...this.flags },
      { resolveServer: false, source: "mock" },
    );
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

/** The same, failing as a flag does while it parses: before any context was settled. */
class FailingWhileParsing extends FailingCommand {
  public async failParsing(error: Error): Promise<void> {
    try {
      await this.catch(error);
    } catch (exit) {
      this.exitCode = (exit as { oclif?: { exit?: number } }).oclif?.exit;
    }
  }
}

/** The same, as one of the ten wizards, which is what has a chain to close. */
class FailingWizard extends FailingCommand {
  public static override wizard = true;
}

describe("BaseCommand errors", () => {
  it("prints the error block for a failure", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_VALIDATION", "Bad port", { hint: "Use 1 to 65535." }));

    expect(cmd.stderr).toEqual(["Error: Bad port (E_VALIDATION)\nUse 1 to 65535."]);
  });

  // A failure is what a script wrapping the CLI reads on stderr, at a terminal
  // as much as off one: `zitadel deploy 2>errors.log` must not lose it.
  it("keeps a normal command's failure on stderr at a terminal", async () => {
    const cmd = new FailingCommand(false);

    await asTerminal(() => cmd.fail(new ZitadelError("E_VALIDATION", "Bad port")));

    expect(cmd.stderr.join("\n")).toContain("Bad port");
  });

  it("spells out the message and the hint, which name what the server answered", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(
      new ZitadelError("E_VALIDATION", "More than one deployment is live.", {
        hint: "Live origins: https://a.example\u001b[2Jwiped.",
      }),
    );

    expect(cmd.stderr.join("\n")).not.toContain("\u001b");
    expect(cmd.stderr).toEqual([
      "Error: More than one deployment is live. (E_VALIDATION)\nLive origins: https://a.example\\x1b[2Jwiped.",
    ]);
  });

  it("keeps the message as it came in the envelope, which a reader parses", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_VALIDATION", "Refused \u001b[2Jwiped"));

    expect(cmd.json).toEqual([expect.objectContaining({ message: "Refused \u001b[2Jwiped" })]);
  });

  // Whether the block is written plain or spelled out, nothing a redirected
  // stderr collects may act on the terminal that later prints the file.
  it("keeps color codes out of a redirected stderr", async () => {
    vi.stubEnv("FORCE_COLOR", "");
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_VALIDATION", "\u001b[31mBad port\u001b[39m"));

    expect(cmd.stderr.join("\n")).not.toContain("\u001b");
    expect(cmd.stderr.join("\n")).toContain("Bad port");
  });

  it("stops a spinner the failed command left drawing", async () => {
    const cmd = new FailingCommand(false);
    new DrawnSpinner("Fetching users");

    await asTerminal(() => cmd.fail(new ZitadelError("E_VALIDATION", "Bad port")));

    expect(DrawnSpinner.active.size).toBe(0);
  });

  it("prints nothing for Ctrl-C, which the terminal already shows, and still exits 130", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(cmd.stderr).toEqual([]);
    expect(cmd.exitCode).toBe(130);
  });

  it("reports the cancellation, not a validation error, when Ctrl-C was followed by another error", async () => {
    const cmd = new FailingCommand(true);
    (cmd as unknown as { controller: AbortController }).controller.abort(
      new ZitadelError("E_CANCELLED", "Cancelled"),
    );

    await cmd.fail(new Error("socket hang up"));

    expect(cmd.json).toEqual([expect.objectContaining({ code: "E_CANCELLED" })]);
    expect(cmd.exitCode).toBe(130);
  });

  it("still answers --json with the envelope for Ctrl-C", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(cmd.json).toEqual([expect.objectContaining({ code: "E_CANCELLED" })]);
  });
});

// Every failure is shown as one block, however it arose. The platform writes
// fragments and oclif writes a rendering of its own; the person reads one
// grammar, and `--json` still carries the message exactly as it was thrown.
describe("the one block every failure is shown as", () => {
  const refused = (message: string) => Object.assign(new Error(message), { oclif: { exit: 2 } });

  it("says a server's lowercase fragment as it was thrown", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(new ZitadelError("E_NOT_FOUND", "variable not found"));

    expect(cmd.stderr).toEqual(["Error: variable not found (E_NOT_FOUND)"]);
  });

  it("leaves the thrown message alone in the envelope", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(new ZitadelError("E_NOT_FOUND", "variable not found"));

    expect(cmd.json).toEqual([expect.objectContaining({ message: "variable not found" })]);
  });

  it("says why oclif refused the command line in the CLI's own words", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(
      refused(
        "The following error occurred:\n  Missing required flag kind\nSee more help with --help",
      ),
    );

    expect(cmd.stderr[0]?.split("\n")[0]).toBe("Error: Missing required flag kind (E_VALIDATION)");
  });

  // The label is the one every ending introduces a command under, whether the
  // ending is drawn or written, set off from what precedes it by a blank
  // line: oclif's "See more help with" is not it.
  it("offers that command's help under Next:, not under oclif's own label", async () => {
    const cmd = new FailingCommand(false);

    await cmd.fail(
      refused(
        "The following error occurred:\n  Missing required flag kind\nSee more help with --help",
      ),
    );

    expect(cmd.stderr[0]).toBe(
      "Error: Missing required flag kind (E_VALIDATION)\n\nNext:\n  $ npx @zitadel/cli@test errors-test --help",
    );
  });

  it("gives the envelope the sentence and help command the terminal shows", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(
      refused(
        "The following error occurred:\n  Missing required flag kind\nSee more help with --help",
      ),
    );

    expect(cmd.json).toEqual([
      expect.objectContaining({
        message: "Missing required flag kind",
        next_commands: ["npx @zitadel/cli@test errors-test --help"],
      }),
    ]);
  });
});

// A follow-up raised below the command is written bare, because the code that
// raised it does not know where the run was pointed.
describe("the follow-ups of a failure", () => {
  const start = new ZitadelError("E_VALIDATION", "Not running", {
    nextCommands: [unscopedCommand("start")],
  });

  it("carry the directory the run was given", async () => {
    const cmd = new FailingCommand(true, [], { cwd: "/work/app" });

    await cmd.fail(start);

    expect(cmd.json).toEqual([
      expect.objectContaining({ next_commands: ["npx @zitadel/cli@test start --cwd /work/app"] }),
    ]);
  });

  it("carry nothing when the run was given none", async () => {
    const cmd = new FailingCommand(true);

    await cmd.fail(start);

    expect(cmd.json).toEqual([
      expect.objectContaining({ next_commands: ["npx @zitadel/cli@test start"] }),
    ]);
  });

  it("keep a directory they name themselves", async () => {
    const cmd = new FailingCommand(true, [], { cwd: "/work/app" });

    await cmd.fail(
      new ZitadelError("E_VALIDATION", "Not running", {
        nextCommands: [unscopedCommand("start --cwd /work")],
      }),
    );

    expect(cmd.json).toEqual([
      expect.objectContaining({ next_commands: ["npx @zitadel/cli@test start --cwd /work"] }),
    ]);
  });

  it("carry the directory typed before a flag refused to parse", async () => {
    const cmd = new FailingWhileParsing(true, ["start", "--cwd", "/work/app"]);

    await cmd.failParsing(start);

    expect(cmd.json).toEqual([
      expect.objectContaining({ next_commands: ["npx @zitadel/cli@test start --cwd /work/app"] }),
    ]);
  });
});

describe("the server of a failure that came before the flags were read", () => {
  it("is the one the command line named", async () => {
    const cmd = new FailingWhileParsing(true, ["--server=http://localhost:9000"]);

    await cmd.failParsing(new ZitadelError("E_VALIDATION", "Bad port"));

    expect(cmd.json).toEqual([expect.objectContaining({ source: "http://localhost:9000" })]);
  });
});

// Ctrl-C closes nothing by itself. Without `catch` telling the chain to stop,
// an interrupted run ends on a bare opening line and the shell prompt is
// drawn inside the gutter.
describe("BaseCommand on an interrupted run", () => {
  it("closes a chain the interrupt left open", async () => {
    const cmd = new FailingWizard(false);

    const { stdout } = await printing(() =>
      asTerminal(async () => {
        await cmd.open();
        cmd.ui.say("something happened");
        await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled"));
        // A real run ends by giving consola its reporters back; without it the
        // next command in this process keeps drawing into this chain.
        cmd.ui.releaseNarration();
      }),
    );

    expect(stdout).toContain("┌");
    expect(stripAnsi(stdout)).toMatch(/└ +Cancelled/);
  });

  it("closes nothing when the interrupt arrived before anything was drawn", async () => {
    const cmd = new FailingWizard(false);

    const { stdout } = await printing(() =>
      asTerminal(async () => {
        await cmd.open();
        await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled"));
        cmd.ui.releaseNarration();
      }),
    );

    expect(stdout).not.toContain("└");
  });

  // A normal command has no chain, so an interrupt leaves nothing open and
  // nothing to close, however much it said on the way.
  it("opens and closes nothing for a normal command", async () => {
    const cmd = new FailingCommand(false);

    const { stdout } = await printing(() =>
      asTerminal(async () => {
        await cmd.open();
        cmd.ui.say("something happened");
        await cmd.fail(new ZitadelError("E_CANCELLED", "Cancelled"));
      }),
    );

    expect(stdout).not.toContain("┌");
    expect(stdout).not.toContain("└");
  });
});

// A wizard's failure is read on stderr like any other, while the chain it
// drew into is still closed on a line of its own.
describe("BaseCommand on a wizard that fails", () => {
  it("writes the error to stderr while its chain is open", async () => {
    const cmd = new FailingWizard(false);

    await asTerminal(async () => {
      await cmd.open();
      cmd.ui.say("something happened");
      await cmd.fail(new ZitadelError("E_VALIDATION", "Bad port"));
      cmd.ui.releaseNarration();
    });

    expect(cmd.stderr.join("\n")).toContain("Bad port");
  });

  it("closes its chain without the error", async () => {
    const cmd = new FailingWizard(false);

    const { stdout } = await printing(() =>
      asTerminal(async () => {
        await cmd.open();
        cmd.ui.say("something happened");
        await cmd.fail(new ZitadelError("E_VALIDATION", "Bad port"));
        cmd.ui.releaseNarration();
      }),
    );

    expect(stdout).toContain("└");
    expect(stdout).not.toContain("Bad port");
  });
});
