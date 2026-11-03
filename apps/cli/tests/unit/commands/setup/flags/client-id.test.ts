import { describe, expect, it } from "vitest";

import { clientIdFlag, readClientId } from "../../../../../src/commands/setup/flags/client-id";

describe("readClientId", () => {
  it("reads a client id trimmed", () => {
    expect(readClientId("  abc123  ")).toBe("abc123");
  });

  it("refuses a blank value", () => {
    expect(() => readClientId("  ")).toThrow(expect.objectContaining({ code: "E_VALIDATION" }));
  });
});

describe("clientIdFlag", () => {
  it("is wired to readClientId", async () => {
    const flag = clientIdFlag({});

    await expect(flag.parse("abc123", {} as never, flag as never)).resolves.toBe("abc123");
  });
});
