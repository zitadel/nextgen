import { describe, expect, it } from "vitest";

import { annotations } from "./knip-annotations.mjs";

const cwd = "/repo";

/** knip's findings with one finding of `type`, as a reporter receives them. */
function findingsWith(type, issue) {
  return { cwd, issues: { [type]: { [issue.filePath]: { [issue.symbol]: issue } } } };
}

describe("annotations", () => {
  it("annotates an unused export on its file, line and column", () => {
    const options = findingsWith("exports", {
      filePath: "/repo/packages/sdk-react/src/types.ts",
      symbol: "knipProbe",
      line: 19,
      col: 14,
    });

    expect(annotations(options)).toEqual([
      "::error file=packages/sdk-react/src/types.ts,line=19,col=14,title=knip: Unused export::Unused export: knipProbe",
    ]);
  });

  it("annotates a finding without a position on its file alone", () => {
    const options = findingsWith("devDependencies", {
      filePath: "/repo/packages/components/package.json",
      symbol: "tslib",
    });

    expect(annotations(options)).toEqual([
      "::error file=packages/components/package.json,title=knip: Unused devDependency::Unused devDependency: tslib",
    ]);
  });

  it("annotates a finding set to warn as a warning", () => {
    const options = findingsWith("types", {
      filePath: "/repo/apps/cli/src/a.ts",
      symbol: "Unused",
      severity: "warn",
    });

    expect(annotations(options)).toEqual([
      "::warning file=apps/cli/src/a.ts,title=knip: Unused exported type::Unused exported type: Unused",
    ]);
  });

  it("annotates nothing when knip found nothing", () => {
    expect(annotations({ cwd, issues: { exports: {}, files: {} } })).toEqual([]);
  });
});
