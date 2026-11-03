import { describe, expect, it } from "vitest";

import { needsForce } from "../../../../../src/commands/api/requirements/force";
import type { ApiRequest } from "../../../../../src/lib/api/request";

const DESTRUCTIVE = {
  operation: {
    destructive: true,
    id: "deleteUser",
  },
  body: {
    a: 1,
  },
} as unknown as ApiRequest;
const ASKED = { dryRun: false, nonInteractive: true, force: false };

describe("needsForce", () => {
  it("is true for a destructive call with a body that nobody can be asked about", () => {
    expect(needsForce(DESTRUCTIVE, ASKED)).toBe(true);
  });

  it.each([
    ["--force", { ...ASKED, force: true }],
    ["a person to ask", { ...ASKED, nonInteractive: false }],
    ["a dry run", { ...ASKED, dryRun: true }],
  ])("is false with %s", (_name, run) => {
    expect(needsForce(DESTRUCTIVE, run)).toBe(false);
  });

  it("is false without a body, whose retry the consent can suggest", () => {
    expect(needsForce({ ...DESTRUCTIVE, body: undefined }, ASKED)).toBe(false);
  });

  it("is false for a call that destroys nothing", () => {
    expect(
      needsForce(
        { ...DESTRUCTIVE, operation: { destructive: false } } as unknown as ApiRequest,
        ASKED,
      ),
    ).toBe(false);
  });
});
