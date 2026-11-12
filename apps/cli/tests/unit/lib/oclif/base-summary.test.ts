import { stripVTControlCharacters as stripAnsi } from "node:util";
import { aConfigAt } from "@tests/helpers/suggestions";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseCommand } from "@/lib/oclif/base";
import type { SuggestedCommand } from "@/lib/suggestion";
import { COLUMN_MARK } from "@/lib/ui/layout";
import { painted, rows } from "@/lib/oclif/rendering";
import type { CommandResult, JsonEnvelope } from "@/lib/oclif/types";
import { printing } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";

/** A command that ends on a summary, so its box is what the assertions read. */
class SummarisingCommand extends BaseCommand {
  public static override readonly id: string = "summary-test";
  public static override wizard: boolean | undefined = true;

  /** What the command wrote for a reader, which `--json` would have silenced. */
  public readonly logged: string[] = [];

  public override jsonEnabled(): boolean {
    return false;
  }

  public override log(message?: string): void {
    this.logged.push(message ?? "");
  }

  protected override async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async finish(
    result: CommandResult,
    flags: Record<string, unknown> = {},
    source = "mock",
  ): Promise<JsonEnvelope> {
    await this.toMeta({ "no-telemetry": true, ...flags }, { resolveServer: false, source });
    try {
      return this.emit(result);
    } finally {
      this.ui.releaseNarration();
    }
  }
}

/** The same, for a command that draws neither chain nor box. */
class AnsweringCommand extends SummarisingCommand {
  public static override readonly id: string = "answer-test";
  public static override wizard = undefined;
}

/** Runs `result` through `emit` at a terminal and returns what was drawn. */
async function drawn(result: CommandResult): Promise<string> {
  const command = new SummarisingCommand([], aConfigAt("0.0.0-test"));

  const { stdout } = await printing(() => asTerminal(() => command.finish(result)));

  return stripAnsi(stdout);
}

/**
 * Runs `result` through `emit` with nobody to draw to, and returns what was
 * written. `terminal` is whether stdout is one: a run with `--non-interactive`
 * at a terminal is still a person reading, while a pipe is a machine.
 */
async function written(
  result: CommandResult,
  options: { terminal?: boolean; plain?: boolean; source?: string } = {},
): Promise<string> {
  const Command = options.plain === true ? AnsweringCommand : SummarisingCommand;
  const command = new Command([], aConfigAt("0.0.0-test"));
  const run = () => command.finish(result, { "non-interactive": true }, options.source ?? "mock");
  await (options.terminal === true ? asTerminal(run) : run());
  return stripAnsi(command.logged.join("\n"));
}

const CANCELLED: CommandResult = {
  status: "skipped",
  reason: "test-cancelled",
  summary: {
    title: "Cancelled, nothing was removed",
    sections: [],
    lines: ["Nothing was removed."],
    next: [{ text: "Remove it whenever you like:", command: "zitadel eject" }],
    boxed: true,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** The widest line drawn, as a terminal measures it. */
const widest = (shown: string): number =>
  Math.max(...shown.split("\n").map((line) => line.trimEnd().length));

describe("the ending of a status", () => {
  const project = {
    project_id: "proj-01K9AA9M3K7E2QX8VB4T",
    issuer: "https://auth.acme-corporation.example.com",
  };

  it("keeps the box 80 columns wide with a hosted issuer in it", async () => {
    const shown = await drawn({
      status: "ok",
      data: {},
      summary: {
        title: "Checked the status of the project",
        sections: [],
        lines: [`Project ${project.project_id}, lifecycle configured, issuer ${project.issuer}.`],
      },
    });

    expect(widest(shown)).toBeLessThanOrEqual(80);
  });
});

describe("BaseCommand endings for a skip", () => {
  it("closes on the skip's own sentence rather than its reason token", async () => {
    const shown = await drawn(CANCELLED);

    expect(shown).toContain("Cancelled, nothing was removed");
    expect(shown).not.toContain("test-cancelled");
  });

  it("draws the skip's summary as a box", async () => {
    const shown = await drawn(CANCELLED);

    expect(shown).toContain("Nothing was removed.");
    expect(shown).toContain("Remove it whenever you like:");
    expect(shown).toContain("zitadel eject");
  });

  it("ends a skip's box with where to find every command, as a success does", async () => {
    const shown = await drawn(CANCELLED);

    expect(shown).toContain("Explore all commands:");
  });

  it("keeps the summary out of the envelope, which still carries the reason", async () => {
    const command = new SummarisingCommand([], aConfigAt("0.0.0-test"));

    const { result: envelope } = await printing(() => asTerminal(() => command.finish(CANCELLED)));

    expect(envelope).toEqual(
      expect.objectContaining({ status: "skipped", reason: "test-cancelled" }),
    );
    expect(envelope).not.toHaveProperty("summary");
  });
});

/**
 * A run nothing can be drawn into used to fall through to a rendering that was
 * neither of the two shapes: `(server: host)` at the top where the ending says where it ran at the end,
 * and, for a wizard, no box at all.
 */
describe("the ending of a run nothing is drawn into", () => {
  const STATUS: CommandResult = {
    status: "ok",
    data: {},
    summary: {
      title: "Checked the status of the project",
      sections: [],
      lines: ["Project proj-1, lifecycle configured."],
    },
    next: { commands: ["zitadel start" as SuggestedCommand] },
  };

  it("introduces a wizard's command under the label its box uses", async () => {
    const shown = await written(STATUS);

    expect(shown).toContain("Next:");
  });

  it("closes a wizard on the line it would have closed the chain on", async () => {
    const shown = await written(STATUS);

    expect(shown).toContain("Checked the status of the project");
  });

  it("frames a wizard's report, as the run a person watches does", async () => {
    const shown = await written(STATUS);

    expect(shown).toContain("Summary");
    expect(shown).toContain("╰");
  });

  it("says where a wizard ran at the end, not as a line above its report", async () => {
    const shown = await written({
      ...STATUS,
      summary: { ...STATUS.summary, ran: "self.example" },
    });

    expect(shown).toContain("Using your Zitadel server at self.example.");
    expect(shown).not.toContain("(server: self.example)");
  });

  // `--non-interactive` says not to ask, not that nobody is reading: at a
  // terminal a normal command still ends on its answer and the one footer,
  // rather than on a sentence with a full stop that no terminal shows.
  it("ends a normal command on its answer and one footer when a terminal is reading", async () => {
    const shown = await written(
      { summary: { title: "No variables found", sections: [] }, status: "ok", data: [] },
      { terminal: true, plain: true },
    );

    expect(shown).toBe("No variables found");
  });

  // Off a terminal a normal command has already chosen the machine form of its
  // answer — tab-separated rows, the whole record — and a count or a footer
  // under it is what breaks `wc -l` and `cut`.
  it("leaves a normal command's answer alone when a machine is reading", async () => {
    const shown = await written(
      {
        summary: { title: "Done", sections: [] },
        status: "ok",
        data: "a\tprimary",
        pretty: rows("a\tprimary"),
      },
      { plain: true },
    );

    expect(shown).toBe("a\tprimary");
  });

  // A builder marks a row it aligned so the layout does not fold it as prose.
  // Nothing folds a machine's answer, so nothing takes the mark off it either:
  // invisible on screen, it still travels with anything copied or parsed out
  // of those bytes.
  it("takes the column mark off an answer nothing is going to fold", async () => {
    const shown = await written(
      {
        summary: { title: "Done", sections: [] },
        status: "ok",
        data: "",
        pretty: painted(`${COLUMN_MARK}value  hello`),
      },
      { plain: true },
    );

    expect(shown).toBe("value  hello");
  });
});

describe("looking for the skills offer", () => {
  /**
   * Gives the machine an installed agent, which is a `.claude` directory in its home, and
   * a config directory that has never been offered the skills.
   */
  function aMachineNeverOffered(): void {
    const home = mkdtempSync(join(tmpdir(), "zitadel-home-"));
    mkdirSync(join(home, ".claude"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("CI", "");
    vi.stubEnv("NO_SKILLS_PROMPT", "");
    vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "zitadel-skills-")));
  }

  /** What a run at a terminal drew, on the machine as it now is. */
  async function ran(
    Command: typeof SummarisingCommand,
    result: CommandResult,
    flags: Record<string, unknown> = {},
  ): Promise<string> {
    const command = new Command([], aConfigAt("0.0.0-test"));
    const { stdout } = await printing(() => asTerminal(() => command.finish(result, flags)));
    return stripAnsi(stdout);
  }

  const DONE: CommandResult = { summary: { title: "Done", sections: [] }, status: "ok", data: "x" };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is done by a command that draws a box, which is the one that carries the offer", async () => {
    aMachineNeverOffered();

    expect(await ran(SummarisingCommand, DONE)).toContain("skills add");
  });

  it("is not done by a normal command, which would pay for a scan it never uses", async () => {
    aMachineNeverOffered();

    expect(await ran(AnsweringCommand, DONE)).not.toContain("skills add");
  });

  it("is not done on a dry run, which must not spend the one offer a machine gets", async () => {
    aMachineNeverOffered();

    expect(await ran(SummarisingCommand, DONE, { "dry-run": true })).not.toContain("skills add");
  });

  it("is not spent by a run that changed nothing, so the next one that does still offers it", async () => {
    aMachineNeverOffered();

    await ran(SummarisingCommand, {
      status: "skipped",
      reason: "already-initialized",
      summary: { title: "Nothing was changed", sections: [] },
    });
    const next = await ran(SummarisingCommand, DONE);

    expect(next).toContain("skills add");
  });
});

describe("the ending of a result with warnings", () => {
  it("says a warning the command returned to a person at a terminal", async () => {
    const shown = await drawn({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: "x",
      warnings: ["the server is older than the CLI"],
    });

    expect(shown).toContain("Warning: the server is older than the CLI");
  });

  it("does not say it twice when the rendering already did", async () => {
    const shown = await drawn({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: "x",
      warnings: ["the server is older than the CLI"],
      warningsShown: true,
    });

    expect(shown).not.toContain("the server is older than the CLI");
  });
});
