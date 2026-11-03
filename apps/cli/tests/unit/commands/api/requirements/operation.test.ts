import { describe, expect, it } from "vitest";

import { chosenOperation } from "../../../../../src/commands/api/requirements/operation";

describe("chosenOperation", () => {
  it("leaves the operation to be chosen when none is named", () => {
    expect(chosenOperation(undefined, undefined)).toEqual({ target: undefined });
  });

  it("finds an operation by its id", () => {
    expect(chosenOperation("queryUsers", undefined)).toMatchObject({
      target: { operation: { id: "queryUsers" } },
    });
  });

  it("refuses an operation no one but an end user's session can call, saying why", () => {
    expect(chosenOperation("getMyUser", undefined)).toEqual({
      reason: expect.stringContaining("authenticated by an end user's session cookie"),
    });
  });

  it("refuses an operation the spec does not have", () => {
    expect(() => chosenOperation("noSuchOperation", undefined)).toThrow("No operation is called");
  });
});
