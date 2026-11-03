import { Config, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { type Admitted, BaseCommand } from "../../../../src/lib/oclif/base";
import { excludes, needs, refuses } from "../../../../src/lib/oclif/rules";
import type { JsonEnvelope } from "../../../../src/lib/oclif/types";
import { cliPackageRoot } from "../../../helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

class Admission extends BaseCommand {
  static override meta = {
    resolveServer: false,
  };

  static override flags = {
    name: Flags.string({ default: "here" }),
    image: Flags.string(),
    runtime: Flags.string({ options: ["binary", "docker"] }),
    follow: Flags.boolean(),
  };

  static override rules = [
    needs(
      "image",
      {
        runtime: "docker",
      },
      {
        message: "{image} needs --runtime docker",
        hint: "Pass --runtime docker.",
      },
    ),
    excludes("follow", "json", {
      message: "Cannot follow with --json",
    }),
  ];

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
  it("hands execute its parsed flags, read as code reads them", async () => {
    const admitted = command(["--name", "api"]);

    await admitted.run();

    expect(admitted.received?.flags.name).toBe("api");
  });

  it("hands execute the positional words a non-strict command takes", async () => {
    const admitted = command(["--name", "api"]);

    await admitted.run();

    expect(admitted.received?.argv).toEqual([]);
  });

  it("refuses a broken rule with its message filled from the flags, before execute runs", async () => {
    const admitted = command(["--image", "tag", "--runtime", "binary"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "tag needs --runtime docker",
      hint: "Pass --runtime docker.",
    });
    expect(admitted.received).toBeUndefined();
  });

  it("lets a rule read whether the run answers in JSON", async () => {
    const admitted = command(["--follow", "--json"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Cannot follow with --json",
    });
  });
});

describe("what a rule can work out for its refusal", () => {
  it("fills the refusal from the values the rule answers with", async () => {
    class Worked extends BaseCommand {
      static override meta = {
        resolveServer: false,
      };

      static override rules = [
        refuses(
          () => {
            return { problem: "it is wrong" };
          },
          {
            message: "Not valid: {problem}",
          },
        ),
      ];

      protected async execute(): Promise<JsonEnvelope> {
        return this.emit({
          status: "ok",
          data: {},
        });
      }
    }

    await expect(new Worked(["--no-telemetry"], config).run()).rejects.toMatchObject({
      message: "Not valid: it is wrong",
    });
  });
});
