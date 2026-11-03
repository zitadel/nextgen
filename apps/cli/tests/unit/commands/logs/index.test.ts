import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import Logs, { tailFlag } from "../../../../src/commands/logs";
import { parseFlag } from "../../../helpers/inputs";

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
    await expect(parseFlag(tailFlag({}), input, "tail")).resolves.toBe(lines);
  });

  it.each(["0", "-1", "1.5", "all", "", "1e3"])("refuses %j", async (input) => {
    await expect(parseFlag(tailFlag({}), input, "tail")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${input.trim()} is not a valid tail`,
      hint: "Use a positive integer.",
    });
  });

  it("shows 200 lines when it is not given", () => {
    expect(tailFlag({}).default).toBe(200);
  });

  it("refuses a count that is not a number of lines before the server is read", async () => {
    const logs = new Logs(["--no-telemetry", "--tail", "0"], config);

    await expect(logs.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("0 is not a valid tail"),
    });
  });
});

describe("--follow beside --json", () => {
  it("is refused, since a stream is never the one envelope --json promises", async () => {
    const logs = new Logs(["--no-telemetry", "--follow", "--json"], config);

    await expect(logs.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Cannot stream logs with --json",
      hint: "Run without --json, or omit --follow.",
    });
  });

  it("is accepted without --json", async () => {
    const logs = new Logs(["--no-telemetry", "--follow"], config);

    await expect(logs.run()).rejects.toMatchObject({
      message: "Local Zitadel runtime has not been started",
    });
  });
});
