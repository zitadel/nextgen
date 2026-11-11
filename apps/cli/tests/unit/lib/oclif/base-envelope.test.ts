import { Command, type Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { Deployment } from "@/lib/backend";
import { BaseCommand } from "@/lib/oclif/base";
import { painted, prose } from "@/lib/oclif/rendering";
import type { CommandResult, JsonEnvelope } from "@/lib/oclif/types";

/**
 * A command that answers the envelope `emit` built, printing nothing. It runs
 * in human mode, because `--json` silences the narration one of these tests
 * reads.
 */
class EnvelopeCommand extends BaseCommand {
  public static override readonly id = "envelope-test";

  public override jsonEnabled(): boolean {
    return false;
  }

  /** What `emit` printed, for the tests that read the rendering. */
  public readonly logged: string[] = [];

  public override log(message?: string): void {
    this.logged.push(message ?? "");
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /** The override, reachable so a test can hold it to oclif's own. */
  public writeJson(json: unknown): void {
    this.logJson(json);
  }

  public async finish(result: CommandResult): Promise<JsonEnvelope> {
    await this.toMeta({ "no-telemetry": true }, { resolveServer: false, source: "mock" });
    return this.emit(result);
  }
}

/**
 * The record the API answers a deployment with. It holds more than the entity
 * names as fields of its own — `project_id`, `kind` and `status` among them —
 * which is what a reader of `--json` is promised.
 */
const RECORD = {
  id: "dep_1",
  project_id: "proj_1",
  release_id: "rel_1",
  kind: "deploy",
  status: "live",
  targets: [
    {
      origin: "https://app.test",
    },
  ],
  deployed_at: "2026-01-01T00:00:00Z",
  metadata: {
    reason: "deploy",
  },
};

/**
 * A command that writes JSON the way oclif does, reached through `super` so the
 * comparison is against the implementation itself and not a copy of it.
 */
class OclifJsonCommand extends Command {
  public writeJson(json: unknown): void {
    super.logJson(json);
  }

  public async run(): Promise<void> {
    throw new Error("unused");
  }
}

function makeCommand(): EnvelopeCommand {
  return new EnvelopeCommand([], { version: "0.0.0-test" } as unknown as Config);
}

describe("BaseCommand envelope", () => {
  it("carries an entity as the record the API sent, and nothing it keeps to itself", async () => {
    const cmd = makeCommand();

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {
        deployment: Deployment.of(RECORD as never),
      },
    });

    // What a reader of `--json` receives is what the serialiser writes, which
    // is where an entity answers the record it stands for.
    const written = JSON.parse(JSON.stringify(envelope)) as {
      data: { deployment: object };
    };
    expect(Object.keys(written.data.deployment)).toEqual(Object.keys(RECORD));
    expect(written.data.deployment).toEqual(RECORD);
  });

  it("carries a list of entities the same way", async () => {
    const cmd = makeCommand();

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {
        items: [Deployment.of(RECORD as never)],
      },
    });

    const written = JSON.parse(JSON.stringify(envelope)) as {
      data: { items: object[] };
    };
    expect(written.data.items).toEqual([RECORD]);
  });

  it("writes what the server wrote into the record as JSON escapes it", async () => {
    const cmd = makeCommand();

    const envelope = await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {
        deployment: Deployment.of({
          ...RECORD,
          metadata: {
            reason: "\u001b[2Jwiped",
          },
        } as never),
      },
    });

    // The serialiser spells a control character out, so what reaches a reader
    // cannot drive their terminal; the rendered text is spelled out on the way
    // out instead, which the renderings below hold it to.
    expect(JSON.stringify(envelope)).toContain("\\u001b[2Jwiped");
  });
});

describe("BaseCommand rendering", () => {
  it("spells out a bespoke rendering, so an interpolated server value cannot drive a terminal", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      pretty: prose("Deployed \u001b[2Jwiped"),
    });

    expect(cmd.logged.join("\n")).toContain("Deployed \\x1b[2Jwiped");
    expect(cmd.logged.join("\n")).not.toContain("\u001b[2J");
  });

  it("spells out a warning beside the generic rendering, which names what was read", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      warnings: ["schema \u001b[2Jwiped has no identifier"],
    });

    expect(cmd.logged.join("\n")).toContain("schema \\x1b[2Jwiped has no identifier");
    expect(cmd.logged.join("\n")).not.toContain("\u001b[2J");
  });

  it("prints a painted rendering as it is, so the colour the CLI added survives", async () => {
    const cmd = makeCommand();

    await cmd.finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: {},
      pretty: painted("\u001b[32mok\u001b[39m"),
    });

    expect(cmd.logged.join("\n")).toContain("\u001b[32mok\u001b[39m");
  });
});

describe("BaseCommand.logJson", () => {
  /**
   * The override restates oclif's own body in order to wrap its result, because
   * `logJson` writes straight to the console and leaves nothing to wrap. This
   * holds the restatement to the original: a payload with nothing to escape
   * must come out exactly as oclif would have written it, so a release that
   * changes how it serialises fails here instead of quietly diverging.
   */
  it("writes what oclif writes, for a payload with nothing to escape", () => {
    const payload = {
      status: "ok",
      data: {
        name: "Müller",
        count: 2,
      },
    };
    const cmd = makeCommand();
    const written: string[] = [];
    const log = console.log;
    console.log = (line: unknown): void => {
      written.push(String(line));
    };

    try {
      cmd.writeJson(payload);
      new OclifJsonCommand([], { version: "0.0.0-test" } as unknown as Config).writeJson(payload);
    } finally {
      console.log = log;
    }

    expect(written).toHaveLength(2);
    expect(written[0]).toBe(written[1]);
  });
});

describe("BaseCommand envelope headline", () => {
  it("gives a success the headline the terminal draws as data.title", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Set variable FOO", sections: [] },
      status: "ok",
      data: { name: "FOO" },
    });

    expect(envelope).toMatchObject({ data: { title: "Set variable FOO", name: "FOO" } });
  });

  it("gives a skip the headline it draws, with no data of its own", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Nothing was removed", sections: [] },
      status: "skipped",
      reason: "not-live",
    });

    expect(envelope).toMatchObject({ data: { title: "Nothing was removed" } });
  });

  it("keeps the data a skip had beside its headline", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Nothing was removed", sections: [] },
      status: "skipped",
      reason: "not-live",
      data: { url: "https://a.test" },
    });

    expect(envelope).toMatchObject({
      data: { title: "Nothing was removed", url: "https://a.test" },
    });
  });

  it("keeps the record an entity stands for beside the headline", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Deployment dep_1", sections: [] },
      status: "ok",
      data: Deployment.of(RECORD as never),
    });

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      data: { title: "Deployment dep_1", ...RECORD },
    });
  });

  it("keeps a title the data already has", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Got it", sections: [] },
      status: "ok",
      data: { title: "Mr" },
    });

    expect(envelope).toMatchObject({ data: { title: "Mr" } });
  });

  it("leaves data that is not an object as it is", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Got it", sections: [] },
      status: "ok",
      data: ["a"],
    });

    expect(envelope).toMatchObject({ data: ["a"] });
  });

  it("adds no headline to what a server answered, passed through as it came", async () => {
    const envelope = await makeCommand().finish({
      summary: { title: "Done", sections: [] },
      status: "ok",
      data: { id: "1" },
      verbatim: true,
    });

    expect(envelope).toMatchObject({ data: { id: "1" } });
    expect(envelope).not.toMatchObject({ data: { title: "Done" } });
  });
});
