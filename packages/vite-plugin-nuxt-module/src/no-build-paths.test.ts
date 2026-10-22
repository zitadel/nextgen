import { describe, expect, it } from "vitest";

import { assertNoBuildPaths, filesWithBuildPaths } from "./no-build-paths.ts";

describe("filesWithBuildPaths", () => {
  it("names the files that contain the workspace path", () => {
    expect(
      filesWithBuildPaths(
        [
          ["a.mjs", "//#region \0liquid:/repo/packages/x/default.liquid"],
          ["b.mjs", "//#region src/b.ts"],
        ],
        "/repo",
      ),
    ).toEqual(["a.mjs"]);
  });
});

describe("assertNoBuildPaths", () => {
  it("fails on output that names the workspace path", () => {
    expect(() => assertNoBuildPaths([["a.mjs", 'import "/repo/src/a.ts";']], "/repo")).toThrow(
      /a\.mjs/,
    );
  });

  it("accepts output with relative paths only", () => {
    expect(() => assertNoBuildPaths([["a.mjs", 'import "./a.mjs";']], "/repo")).not.toThrow();
  });
});
