import { describe, expect, it } from "vitest";

import Start from "../../../../src/commands/start";
import { parseFlag } from "../../../helpers/inputs";

describe("--port", () => {
  it.each(["1", "8080", "65535"])("reads %s", async (input) => {
    await expect(parseFlag(Start.flags.port, input, "port")).resolves.toBe(Number(input));
  });

  it.each(["0", "65536", "-1", "many", "80.5", "", "1e3", "9".repeat(309), "9007199254740993"])(
    "refuses %j, naming the ports a server can listen on",
    async (input) => {
      await expect(parseFlag(Start.flags.port, input, "port")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `${input} is not a TCP port`,
        hint: "Use a TCP port from 1 to 65535.",
      });
    },
  );
});
