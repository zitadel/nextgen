import { describe, expect, it } from "vitest";

import { closest, didYouMean } from "@/lib/zitadel/utils/spelling";

describe("closest", () => {
  it.each([
    { name: "githb", candidates: ["github", "gitlab"], expected: "github" },
    { name: "GitHub", candidates: ["github", "gitlab"], expected: "github" },
    { name: "GitHub", candidates: ["github", "GITHUB"], expected: undefined },
    { name: "githbu", candidates: ["github", "google"], expected: "github" },
    { name: "gthb", candidates: ["github", "google"], expected: undefined },
    { name: "gogle", candidates: ["google", "github"], expected: "google" },
    { name: "aple", candidates: ["apple", "maple"], expected: undefined },
    { name: "aple", candidates: ["apple", "apple"], expected: "apple" },
    { name: "appel", candidates: ["apple", "gitlab"], expected: "apple" },
    { name: "apl", candidates: ["apple"], expected: undefined },
    { name: "apl", candidates: ["app", "ape"], expected: undefined },
    { name: "apl", candidates: ["app", "github"], expected: "app" },
    { name: "go", candidates: ["gl", "google"], expected: undefined },
    { name: "okta", candidates: ["okta"], expected: undefined },
    { name: "okta", candidates: ["okta", "oktb"], expected: "oktb" },
    { name: "okta", candidates: [], expected: undefined },
    { name: "zzzzzz", candidates: ["github", "google"], expected: undefined },
  ])("names $expected for $name among $candidates", ({ name, candidates, expected }) => {
    const meant = closest(name, candidates);

    expect(meant).toBe(expected);
  });

  it("reads the candidates from any iterable", () => {
    const meant = closest("githb", new Set(["github", "gitlab"]));

    expect(meant).toBe("github");
  });
});

describe("didYouMean", () => {
  it.each([
    { name: "githb", candidates: ["github"], expected: ' Did you mean "github"?' },
    { name: "zzzzzz", candidates: ["github"], expected: "" },
  ])("says $expected for $name", ({ name, candidates, expected }) => {
    const sentence = didYouMean(name, candidates);

    expect(sentence).toBe(expected);
  });
});
