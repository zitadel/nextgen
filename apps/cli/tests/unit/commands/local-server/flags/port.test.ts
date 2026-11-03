import { describe, expect, it } from "vitest";

import {
  PORT_REFUSAL,
  portFlag,
  readPort,
} from "../../../../../src/commands/local-server/flags/port";

describe("readPort", () => {
  it.each(["1", "8080", "65535"])("reads %s", (input) => {
    expect(readPort(input)).toBe(Number(input));
  });

  it.each(["0", "65536", "-1", "many", "80.5", ""])("refuses %j with the port refusal", (input) => {
    expect(() => readPort(input)).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: PORT_REFUSAL.message.replace("{value}", input),
        hint: "Use a TCP port from 1 to 65535.",
      }),
    );
  });
});

describe("portFlag", () => {
  it("is wired to readPort", async () => {
    const flag = portFlag({});

    await expect(flag.parse("99999", {} as never, flag as never)).rejects.toMatchObject({
      message: "99999 is not a TCP port",
    });
  });
});
