import type { Config } from "@oclif/core";
import { stripAnsi } from "consola/utils";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
vi.mock("rosie-skills", () => rosie);

import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { SuggestedCommand } from "../../../../src/lib/suggestion";
import { COLUMN_MARK } from "../../../../src/lib/ui/layout";
import { painted, rows } from "../../../../src/lib/oclif/rendering";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";
import { asTerminal } from "../../../helpers/terminal";

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
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  try {
    const command = new SummarisingCommand([], { version: "0.0.0-test" } as unknown as Config);
    await asTerminal(() => command.finish(result));
  } finally {
    write.mockRestore();
  }
  return stripAnsi(chunks.join(""));
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
  const command = new Command([], { version: "0.0.0-test" } as unknown as Config);
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
    const command = new SummarisingCommand([], { version: "0.0.0-test" } as unknown as Config);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const envelope = await asTerminal(() => command.finish(CANCELLED));

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
  const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };

  /** How often a run looked for an installed agent, on a machine that has not been offered. */
  async function looked(Command: typeof SummarisingCommand, flags: Record<string, unknown> = {}) {
    rosie.agents.mockReset();
    rosie.agents.mockResolvedValue([CLAUDE]);
    vi.stubEnv("CI", "");
    vi.stubEnv("NO_SKILLS_PROMPT", "");
    vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "zitadel-skills-")));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const command = new Command([], { version: "0.0.0-test" } as unknown as Config);
    await asTerminal(() =>
      command.finish({ summary: { title: "Done", sections: [] }, status: "ok", data: "x" }, flags),
    );
    vi.unstubAllEnvs();
    return rosie.agents.mock.calls.length;
  }

  it("is done by a command that draws a box, which is the one that carries the offer", async () => {
    expect(await looked(SummarisingCommand)).toBe(1);
  });

  it("is not done by a normal command, which would pay for a scan it never uses", async () => {
    expect(await looked(AnsweringCommand)).toBe(0);
  });

  it("is not done on a dry run, which must not spend the one offer a machine gets", async () => {
    expect(await looked(SummarisingCommand, { "dry-run": true })).toBe(0);
  });
});
