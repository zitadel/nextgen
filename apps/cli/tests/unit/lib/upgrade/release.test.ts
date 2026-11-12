import { describe, expect, it } from "vitest";

import { Release } from "@/lib/upgrade";

describe("Release.isNewerThan", () => {
  it.each([
    ["2.0.0", "1.0.0", true],
    ["1.0.0", "1.0.0", false],
    ["1.0.0", "2.0.0", false],
    ["1.0.0", "1.0.0-alpha.1", true],
    ["2.0.0", "dev", false],
  ])("%s over %s is %s", (latest, current, newer) => {
    expect(new Release(latest).isNewerThan(current)).toBe(newer);
  });
});

describe("Release.from", () => {
  it.each([undefined, 5, "dev", "\u001b[2J"])("is undefined for %s", (value) => {
    expect(Release.from(value)).toBeUndefined();
  });

  it("is undefined without a version", () => {
    expect(Release.from(undefined)).toBeUndefined();
  });

  it("holds the version it is given", () => {
    expect(Release.from("1.2.3")?.version).toBe("1.2.3");
  });
});
