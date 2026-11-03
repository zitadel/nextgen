import { Config, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { type Admitted, BaseCommand } from "../../../../src/lib/oclif/base";
import { ends, requirement, unmet } from "../../../../src/lib/oclif/requirements";
import { excludes, needs, refuses } from "../../../../src/lib/oclif/rules";
import type { JsonEnvelope } from "../../../../src/lib/oclif/types";
import { cliPackageRoot } from "../../../helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

const resolutions: string[] = [];

const FOUND = requirement({
  refusal: {
    message: "Nothing for {name}",
    hint: "Create it in {cwd}.",
    next: ["start"],
  },
  resolve: async ({ flags }) => {
    resolutions.push("found");
    return flags.name === "missing" ? undefined : { url: `http://${String(flags.name)}.test` };
  },
  source: (found) => found.url,
});

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

  static override requires = {
    found: FOUND,
  };

  public received: Admitted<typeof Admission> | undefined;

  protected async execute(input: Admitted<typeof Admission>): Promise<JsonEnvelope> {
    this.received = input;
    return this.emit({
      status: "ok",
      data: {},
    });
  }

  public get source(): string {
    return this.meta.source;
  }
}

function command(argv: string[]): Admission {
  return new Admission(["--no-telemetry", ...argv], config);
}

describe("the lifecycle every command shares", () => {
  it("hands execute the parsed flags and what each requirement found", async () => {
    const admitted = command(["--name", "api"]);

    await admitted.run();

    expect(admitted.received?.flags.name).toBe("api");
    expect(admitted.received?.found).toEqual({ url: "http://api.test" });
  });

  it("makes the server a requirement found the one the run is about", async () => {
    const admitted = command(["--name", "api"]);

    await admitted.run();

    expect(admitted.source).toBe("http://api.test");
  });

  it("refuses a broken rule with its message filled from the flags, before anything runs", async () => {
    resolutions.length = 0;
    const admitted = command(["--image", "tag", "--runtime", "binary"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "tag needs --runtime docker",
      hint: "Pass --runtime docker.",
    });
    expect(admitted.received).toBeUndefined();
    expect(resolutions).toEqual([]);
  });

  it("lets a rule read whether the run answers in JSON", async () => {
    const admitted = command(["--follow", "--json"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Cannot follow with --json",
    });
  });

  it("refuses a requirement that found nothing, naming what the run could do next", async () => {
    const admitted = command(["--name", "missing"]);

    await expect(admitted.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Nothing for missing",
      hint: expect.stringContaining("Create it in"),
      nextCommands: [expect.stringContaining(" start")],
    });
    expect(admitted.received).toBeUndefined();
  });
});

describe("what a rule and a requirement can work out for their refusal", () => {
  it("fills the refusal of a rule from the values it answers with", async () => {
    class Worked extends BaseCommand {
      static override meta = {
        resolveServer: false,
      };

      static override flags = {
        name: Flags.string(),
      };

      static override rules = [
        refuses(() => ({ problem: "it is wrong" }), {
          message: "Not valid: {problem}",
        }),
      ];

      protected async execute(): Promise<JsonEnvelope> {
        return this.emit({ status: "ok", data: {} });
      }
    }

    await expect(new Worked(["--no-telemetry"], config).run()).rejects.toMatchObject({
      message: "Not valid: it is wrong",
    });
  });

  it("fills the refusal of a requirement from what it learned, under the code it names", async () => {
    class Learned extends BaseCommand {
      static override meta = {
        resolveServer: false,
      };

      static override requires = {
        found: requirement({
          refusal: {
            code: "E_NOT_FOUND",
            message: "No {name}; there are {names}",
          },
          resolve: async () => unmet({ name: "x", names: "a, b" }),
        }),
      };

      protected async execute(): Promise<JsonEnvelope> {
        return this.emit({ status: "ok", data: {} });
      }
    }

    await expect(new Learned(["--no-telemetry"], config).run()).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      message: "No x; there are a, b",
    });
  });
});

describe("a requirement that ends the run", () => {
  it("answers with its result without executing", async () => {
    let executed = false;

    class Ending extends BaseCommand {
      static override meta = {
        resolveServer: false,
      };

      static override requires = {
        nothing: requirement({
          resolve: async () =>
            ends({
              status: "skipped",
              reason: "Nothing to do",
            }),
        }),
      };

      protected async execute(): Promise<JsonEnvelope> {
        executed = true;
        return this.emit({ status: "ok", data: {} });
      }
    }

    const envelope = await new Ending(["--no-telemetry"], config).run();

    expect(envelope.status).toBe("skipped");
    expect(executed).toBe(false);
  });
});
