import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

describe("WrappedCommand", () => {
  it("drops the global flags the plugin's own command refuses", async () => {
    const result = await runCliForTest([
      "version",
      "--non-interactive",
      "--no-telemetry",
      "--json",
    ]);

    expect(result).toSucceed();
    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      command: "version",
    });
  });

  it("hands the plugin the flags it declares", async () => {
    const result = await runCliForTest(["commands", "--hidden", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      data: {
        result: expect.arrayContaining([expect.objectContaining({ id: "deployments:list" })]),
      },
    });
  });

  it("answers a list the plugin returned as the envelope's data.result", async () => {
    const result = await runCliForTest(["commands", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({ data: { result: expect.any(Array) } });
  });

  it("answers what a plugin printed, when it returned nothing, as data.output", async () => {
    const result = await runCliForTest(["help", "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({ data: { output: expect.any(String) } });
  });

  it("answers a failure of the plugin's own command without the framework's error object", async () => {
    const result = await runCliForTest(["help", "nonexist", "--json"]);

    expect(result).toFailWith("E_VALIDATION");
    expect(parseJson(result.stdout)).not.toHaveProperty("details");
  });

  it("answers a flag the plugin refuses as the failure envelope", async () => {
    const result = await runCliForTest(["commands", "--sort", "bogus", "--json"]);

    expect(result).toFailWith("E_VALIDATION");
  });
});
