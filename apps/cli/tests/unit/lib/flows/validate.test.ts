import { describe, expect, it } from "vitest";

import { buildFlow, validateFlows } from "../../../../src/lib/flows";
import { ZitadelError } from "../../../../src/lib/errors";

describe("validateFlows", () => {
  it("returns the parsed flows on success", () => {
    const flow = buildFlow(["email"]);
    expect(validateFlows([flow])).toHaveLength(1);
  });

  it("throws E_VALIDATION when any input fails to parse", () => {
    const flow = buildFlow(["email"]);
    expect(() => validateFlows([flow, { name: "bad" }])).toThrow(ZitadelError);
  });

  it("aggregates issues across all invalid inputs in one error", () => {
    let caught: unknown;
    try {
      validateFlows([{ name: "bad" }, { name: "alsobad" }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    const issues = (caught as ZitadelError).details?.issues as Array<{ index: number }>;
    expect(issues).toHaveLength(2);
    expect(issues[0].index).toBe(0);
    expect(issues[1].index).toBe(1);
  });

  it("returns an empty array for an empty input", () => {
    expect(validateFlows([])).toEqual([]);
  });
});
