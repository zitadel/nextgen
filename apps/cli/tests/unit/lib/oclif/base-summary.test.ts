import type { Config } from "@oclif/core";
import { stripAnsi } from "consola/utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";
import { asTerminal } from "../../../helpers/terminal";

/** A command that ends on a summary, so its box is what the assertions read. */
class SummarisingCommand extends BaseCommand {
  public static override readonly id = "summary-test";
  public static override summarises = true;

  public override jsonEnabled(): boolean {
    return false;
  }

  async run(): Promise<never> {
    throw new Error("unused");
  }

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    try {
      return this.emit(result);
    } finally {
      this.ui.releaseNarration();
    }
  }
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

describe("the generic rendering of a command's data", () => {
  const project = {
    project_id: "proj-01K9AA9M3K7E2QX8VB4T",
    lifecycle: "configured",
    issuer: "https://auth.acme-corporation.example.com",
  };

  it("says the project as a sentence, not as columns nothing is aligned to", async () => {
    const shown = await drawn({ status: "ok", data: { title: "Zitadel status.", project } });

    expect(shown).toContain("Project proj-01K9AA9M3K7E2QX8VB4T, lifecycle configured");
    expect(shown).not.toContain("project=proj-01K9AA9M3K7E2QX8VB4T");
  });

  it("keeps the box 80 columns wide with a hosted issuer in it", async () => {
    const shown = await drawn({ status: "ok", data: { title: "Zitadel status.", project } });

    expect(widest(shown)).toBeLessThanOrEqual(80);
  });

  // A leftover of the plan/apply → deploy rename: no command emits the key.
  it("says nothing about an apply key, which nothing emits any more", async () => {
    const shown = await drawn({
      status: "ok",
      data: {
        title: "Zitadel status.",
        apply: { config_version: 3, hash: "abcdef123456789", environment: "production" },
      },
    });

    expect(shown).not.toContain("Apply:");
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

  it("falls back to the rendered reason for a skip that brought no summary", async () => {
    const shown = await drawn({ status: "skipped", reason: "nothing-to-do" });

    expect(shown).toContain("Skipped: nothing-to-do");
  });
});
