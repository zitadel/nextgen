import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { Deployment } from "../../../../src/lib/backend";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import type { CommandResult, JsonEnvelope } from "../../../../src/lib/oclif/types";

/** A command that answers the envelope `emit` built, printing nothing. */
class EnvelopeCommand extends BaseCommand {
  public static override readonly id = "envelope-test";

  public override jsonEnabled(): boolean {
    return true;
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

/** The record the API answers a deployment with. */
const RECORD = {
  id: "dep_1",
  release_id: "rel_1",
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
    expect(Object.keys(data.deployment)).toEqual([
      "id",
      "release_id",
      "targets",
      "deployed_at",
      "metadata",
    ]);
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
