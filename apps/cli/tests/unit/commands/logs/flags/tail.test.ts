import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import Logs from "../../../../../src/commands/logs";
import { DEFAULT_TAIL, readTail, TAIL_REFUSAL } from "../../../../../src/commands/logs/flags/tail";

const config = {
  version: "0.0.0-test",
  runHook: async () => {
    return {
      successes: [],
      failures: [],
    };
  },
} as unknown as Config;

describe("readTail", () => {
  it.each([
    ["1", 1],
    ["200", 200],
    ["5000", 5000],
    [" 42 ", 42],
  ])("reads %j as %i lines", (input, lines) => {
    expect(readTail(input)).toBe(lines);
  });

  it.each(["0", "-1", "1.5", "all", "", "1e3"])("refuses %j", (input) => {
    expect(() => {
      return readTail(input);
    }).toThrow(`${input.trim()} is not a valid tail`);
  });

  it("refuses with the wording the flag shows, as a validation failure", () => {
    try {
      readTail("0");
      expect.unreachable("0 is not a tail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "0 is not a valid tail",
        hint: TAIL_REFUSAL.hint,
      });
    }
  });

  it("shows 200 lines when the flag is not given", () => {
    expect(DEFAULT_TAIL).toBe(200);
  });
});

describe("--tail", () => {
  it("refuses a count that is not a number of lines before the server is read", async () => {
    const logs = new Logs(["--no-telemetry", "--tail", "0"], config);

    await expect(logs.run()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("0 is not a valid tail"),
    });
  });
});
