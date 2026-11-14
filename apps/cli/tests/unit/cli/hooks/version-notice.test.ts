import { describe, expect, it } from "vitest";

import { isVersionRun } from "@/cli/hooks/version-notice";

describe("isVersionRun", () => {
  it.each([
    [["--version"], true],
    [["version"], true],
    [["version", "--verbose"], true],
    [["version", "--json"], false],
    [["doctor"], false],
    [["doctor", "--version"], false],
    [[], false],
  ])("%j is %s", (argv, expected) => {
    expect(isVersionRun(argv)).toBe(expected);
  });
});
