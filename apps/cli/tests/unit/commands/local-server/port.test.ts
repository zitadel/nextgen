import { describe, expect, it } from "vitest";

import { portFlag } from "../../../../src/commands/local-server/port";
import { parseFlag } from "../../../helpers/inputs";

describe("a local port flag", () => {
  it.each(["1", "8080", "65535"])("reads %s", async (input) => {
    await expect(parseFlag(portFlag({}), input, "port")).resolves.toBe(Number(input));
  });

  it.each(["0", "65536", "-1", "many", "80.5", "", "1e3", "9".repeat(309), "9007199254740993"])(
    "refuses %j with the port refusal",
    async (input) => {
      await expect(parseFlag(portFlag({}), input, "port")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `${input} is not a TCP port`,
        hint: "Use a TCP port from 1 to 65535.",
      });
    },
  );
});
