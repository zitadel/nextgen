import { describe, expect, it } from "vitest";

import { IDP_CHECKS, PROVIDER_PROBES } from "../../../../../src/lib/checks/idp";

describe("PROVIDER_PROBES", () => {
  it("knows Google's wording", () => {
    expect(Object.keys(PROVIDER_PROBES)).toEqual(["google"]);
  });
});

describe("IDP_CHECKS", () => {
  it("runs the live sign-in last, so it sees how every other check went", () => {
    expect(IDP_CHECKS.at(-1)?.name).toBe("sign-in");
  });

  it("gives every check its own name, since dependencies are named", () => {
    expect(new Set(IDP_CHECKS.map((check) => check.name)).size).toBe(IDP_CHECKS.length);
  });
});
