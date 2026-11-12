import { describe, expect, it } from "vitest";

import { Dependency } from "@/lib/upgrade/dependency";

describe("Dependency", () => {
  it.each([
    ["1.2.3", true],
    ["^1.2.3", false],
    ["latest", false],
    ["workspace:*", false],
  ])("%s is exact: %s", (specifier, exact) => {
    expect(new Dependency("@zitadel/api", specifier).isExact).toBe(exact);
  });

  it.each([
    ["1.0.0", "2.0.0", true, false],
    ["2.0.0", "2.0.0", false, false],
    ["3.0.0", "2.0.0", false, true],
    ["^1.0.0", "2.0.0", false, false],
    ["1.0.0", "dev", false, false],
  ])("%s against %s: behind %s, ahead %s", (specifier, version, behind, ahead) => {
    const dependency = new Dependency("@zitadel/api", specifier);

    expect([dependency.isBehind(version), dependency.isAhead(version)]).toEqual([behind, ahead]);
  });
});
