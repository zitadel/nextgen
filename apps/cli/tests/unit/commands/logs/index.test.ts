import type { Config } from "@oclif/core";
import { describe, expect } from "vitest";

import Logs from "@/commands/logs";
import { it } from "@tests/helpers/fixtures";
import { parseFlag } from "@tests/helpers/inputs";

const config = {
  version: "0.0.0-test",
  runHook: async () => {
    return {
      successes: [],
      failures: [],
    };
  },
} as unknown as Config;

describe("--tail", () => {
  it.each([
    ["1", 1],
    ["200", 200],
    ["5000", 5000],
    [" 42 ", 42],
  ])("reads %j as %i lines", async (input, lines) => {
    await expect(parseFlag(Logs.flags.tail, input, "tail")).resolves.toBe(lines);
  });

  it.each(["0", "-1", "1.5", "all", "", "1e3"])("refuses %j", async (input) => {
    await expect(parseFlag(Logs.flags.tail, input, "tail")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${input.trim()} is not a valid tail`,
      hint: "Use a positive integer.",
    });
  });

  it("shows 200 lines when it is not given", () => {
    expect(Logs.flags.tail.default).toBe(200);
  });

  it("refuses a count that is not a number of lines before the server is read", async () => {
    const logs = new Logs(["--no-telemetry", "--tail", "0"], config);

    await expect(logs.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("0 is not a valid tail"),
    });
  });
});

/** `logs`, with the server it resolves before the run has a context exposed. */
class Reading extends Logs {
  public sourceFor(cwd: string): Promise<string> {
    return this.sourceOf({}, cwd);
  }
}

describe("the server a run of logs is about", () => {
  it("is the default local one where nothing was started in the directory", async ({ dir }) => {
    const logs = new Reading(["--no-telemetry", "--cwd", dir], config);

    await expect(logs.sourceFor(dir)).resolves.toBe("http://localhost:8080");
  });
});

// Every run names a directory of its own. `--follow` tails the server started
// in the nearest directory upwards, so a run that named none would find the
// developer's own server and never stop.
describe("--follow beside --json", () => {
  it("is refused, since a stream is never the one envelope --json promises", async ({ dir }) => {
    const logs = new Logs(["--no-telemetry", "--cwd", dir, "--follow", "--json"], config);

    await expect(logs.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Cannot stream logs with --json",
      hint: "Run without --json, or omit --follow.",
    });
  });

  it("is accepted without --json, and finds no server to follow", async ({ dir }) => {
    const logs = new Logs(["--no-telemetry", "--cwd", dir, "--follow"], config);

    await expect(logs.run()).rejects.toMatchObject({
      message: "Local Zitadel runtime has not been started",
    });
  });
});
