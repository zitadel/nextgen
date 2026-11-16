import { describe, expect, it } from "vitest";

import { CliPackage } from "@/lib/upgrade";

describe("CliPackage#distTag", () => {
  it.each([
    ["0.1.0-alpha.1", "alpha"],
    ["1.0.0-beta.2", "beta"],
    ["0.1.0", "latest"],
    ["v0.1.0", "latest"],
  ])("names the dist-tag of %s as %s", (version, expected) => {
    expect(CliPackage.at(version).distTag()).toBe(expected);
  });
});

describe("CliPackage#selector", () => {
  it.each([
    ["1.0.0-alpha.25", "1.0.0-alpha.25"],
    ["v1.0.0-alpha.25", "1.0.0-alpha.25"],
    ["0.1.0", "0.1.0"],
    ["1.0.0", "1.0.0"],
    ["1.0.0-beta.2", "beta"],
  ])("selects CLI %s as %s, which is what a scaffold pins the SDKs at", (version, expected) => {
    expect(CliPackage.at(version).selector()).toBe(expected);
  });
});

describe("CliPackage.isTrain", () => {
  it.each([
    ["0.1.0", true],
    ["v1.0.0-alpha.25", true],
    ["1.0.0-beta.2", false],
    ["0.0.0-test", false],
  ])("reads %s as %s", (version, expected) => {
    expect(CliPackage.isTrain(version)).toBe(expected);
  });
});
