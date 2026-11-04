import type { Config } from "@oclif/core";
import consola, { type ConsolaReporter } from "consola";
import { afterEach, describe, expect, it } from "vitest";

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

  public override log(): void {
    /* the envelope is what these tests read, not what was printed */
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
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

    const data = (envelope as { data: { deployment: object } }).data;
    expect(Object.keys(data.deployment)).toEqual(Object.keys(RECORD));
    expect(data.deployment).toEqual(RECORD);
  });

  it("carries a list of entities the same way", async () => {
    const cmd = makeCommand();

    const envelope = await cmd.finish({
      status: "ok",
      data: {
        items: [Deployment.of(RECORD as never)],
      },
    });

    const data = (envelope as { data: { items: object[] } }).data;
    expect(data.items).toEqual([RECORD]);
  });

  it("escapes what the server wrote into the record", async () => {
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

    const data = (envelope as { data: { deployment: { metadata: { reason: string } } } }).data;
    expect(data.deployment.metadata.reason).toBe("\\x1b[2Jwiped");
  });
});

describe("BaseCommand narration", () => {
  const reporters = consola.options.reporters;

  afterEach(() => {
    consola.setReporters([...reporters]);
  });

  it("escapes what a step narrates, because a run installs the reporter", async () => {
    const printed: unknown[][] = [];
    const capture: ConsolaReporter = {
      log(logObj) {
        printed.push(logObj.args);
      },
    };
    consola.setReporters([capture]);
    const cmd = makeCommand();

    await cmd.finish({
      status: "ok",
      data: {},
    });
    consola.success("Created project \u001b[2Jproj_1");

    expect(printed).toEqual([["Created project \\x1b[2Jproj_1"]]);
  });
});
