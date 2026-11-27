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
      "::error file=packages/sdk-react/src/types.ts,line=19,col=14,title=knip%3A Unused export::Unused export: knipProbe",
    ]);
  });

  it("annotates a finding without a position on its file alone", () => {
    const options = findingsWith("devDependencies", {
      filePath: "/repo/packages/components/package.json",
      symbol: "tslib",
    });

    expect(annotations(options)).toEqual([
      "::error file=packages/components/package.json,title=knip%3A Unused devDependency::Unused devDependency: tslib",
    ]);
  });

  it("annotates a finding set to warn as a warning", () => {
    const options = findingsWith("types", {
      filePath: "/repo/apps/cli/src/a.ts",
      symbol: "Unused",
      severity: "warn",
    });

    expect(annotations(options)).toEqual([
      "::warning file=apps/cli/src/a.ts,title=knip%3A Unused exported type::Unused exported type: Unused",
    ]);
  });

  it("percent-encodes a colon or comma in a property so GitHub keeps the file", () => {
    const options = findingsWith("files", {
      filePath: "/repo/odd:name,1.ts",
      symbol: "odd:name,1.ts",
    });

    expect(annotations(options)).toEqual([
      "::error file=odd%3Aname%2C1.ts,title=knip%3A Unused file::Unused file: odd:name,1.ts",
    ]);
  });

  it("names an enum member with its enum", () => {
    const options = findingsWith("enumMembers", {
      filePath: "/repo/src/a.ts",
      symbol: "Unused",
      parentSymbol: "Color",
    });

    expect(annotations(options)).toEqual([
      "::error file=src/a.ts,title=knip%3A Unused enum member::Unused enum member: Color.Unused",
    ]);
  });

  it("annotates a kind of finding it has no title for under knip's own name for it", () => {
    const options = findingsWith("somethingNew", { filePath: "/repo/src/a.ts", symbol: "x" });

    expect(annotations(options)).toEqual([
      "::error file=src/a.ts,title=knip%3A somethingNew::somethingNew: x",
    ]);
  });

  it("annotates nothing when knip found nothing", () => {
    expect(annotations({ cwd, issues: { exports: {}, files: {} } })).toEqual([]);
  });
});
