import { Config, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type Admitted, BaseCommand } from "@/lib/oclif/base";
import { reads, whole } from "@/lib/oclif/flags";
import type { JsonEnvelope } from "@/lib/oclif/types";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

class Admission extends BaseCommand {
  static override meta = {
    resolveServer: false,
  };

  static override strict = false;

  static override flags = {
    "client-id": Flags.string(),
    port: Flags.custom<number>({
      parse: reads({
        schema: whole.pipe(z.number().min(1).max(65_535)),
        refusal: {
          message: "{value} is not a TCP port",
        },
      }),
    })(),
  };

  public received: Admitted<typeof Admission> | undefined;

  protected async execute(input: Admitted<typeof Admission>): Promise<JsonEnvelope> {
    this.received = input;
    return this.emit({
      status: "ok",
      data: {},
    });
  }
}

function command(argv: string[]): Admission {
  return new Admission(["--no-telemetry", ...argv], config);
}

describe("the lifecycle every command shares", () => {
  it("hands execute a flag read as code reads it, not as the command line spells it", async () => {
    const admitted = command(["--client-id", "abc"]);

    await admitted.run();

    expect(admitted.received?.flags.clientId).toBe("abc");
  });

  it("hands execute the positional words a non-strict command takes", async () => {
    const admitted = command(["one", "two"]);

    await admitted.run();

    expect(admitted.received?.argv).toEqual(["one", "two"]);
  });

  it("refuses a flag the command does not accept before execute runs", async () => {
    const admitted = command(["--port", "0"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "0 is not a TCP port",
    });
    expect(admitted.received).toBeUndefined();
  });

  it("puts back the message a flag raised, which oclif rewrites with its own prefix", async () => {
    const admitted = command(["--port", "0"]);

    await expect(admitted.run()).rejects.toMatchObject({
      message: "0 is not a TCP port",
    });
  });
});
