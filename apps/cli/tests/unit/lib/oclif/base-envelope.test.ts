import { Command, type Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { Deployment } from "../../../../src/lib/backend";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";

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
    // cannot drive their terminal; the escaping of the rendered text is
    // `escapeControlCharacters`' to do, and the narration test below covers it.
    expect(JSON.stringify(envelope)).toContain("\\u001b[2Jwiped");
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
