import { describe, expect, it } from "vitest";

import { wantedWorkspaces } from "./knip-workspaces.mjs";

const REACT = ["@zitadel/sdk-react", "packages/sdk-react"];
const VUE = ["@zitadel/sdk-vue", "packages/sdk-vue"];

describe("wantedWorkspaces", () => {
  it.each([
    ["--workspace <name>", ["--workspace", "@zitadel/sdk-react"]],
    ["--workspace=<name>", ["--workspace=@zitadel/sdk-react"]],
    ["-W <name>", ["-W", "@zitadel/sdk-react"]],
    ["-W<name>", ["-W@zitadel/sdk-react"]],
    ["--workspace <directory>", ["--workspace", "packages/sdk-react"]],
    ["--workspace ./<directory>/", ["--workspace", "./packages/sdk-react/"]],
  ])("loads only the package %s names", (_, argv) => {
    const wanted = wantedWorkspaces(argv);

    expect([wanted(...REACT), wanted(...VUE)]).toEqual([true, false]);
  });

  it("loads every package a repeated filter names", () => {
    const wanted = wantedWorkspaces([
      "--workspace",
      "@zitadel/sdk-react",
      "-W",
      "packages/sdk-vue",
    ]);

    expect([wanted(...REACT), wanted(...VUE)]).toEqual([true, true]);
  });

  it.each([
    ["no filter", []],
    ["a glob", ["--workspace", "./packages/sdk-*"]],
    ["a negation", ["--workspace", "!@zitadel/sdk-vue"]],
    ["a filter with no value", ["--workspace"]],
  ])("loads every package for %s", (_, argv) => {
    const wanted = wantedWorkspaces(argv);

    expect([wanted(...REACT), wanted(...VUE)]).toEqual([true, true]);
  });
});
