import { beforeAll, describe, expect, it } from "vitest";

import { Baseline, type Finding, lintSpec } from "./openapi-lint";

/** A first run pulls the image before it lints. */
const LINT_TIMEOUT = 600_000;

/**
 * A finding of a rule at a path.
 *
 * @param rule the rule id
 * @param path the JSONPath
 * @returns the finding
 */
function finding(rule: string, path: string): Finding {
  return { rule, severity: "warn", path, line: 1, column: 1, message: "" };
}

describe("Baseline", () => {
  const baseline = Baseline.of(["a $.x", "a $.y", "b $.x"]);

  it("names the findings it does not list", () => {
    expect(baseline.newFindings([finding("a", "$.x"), finding("c", "$.z")])).toEqual(["c $.z"]);
  });

  it("names the lines nothing reports any more", () => {
    expect(baseline.fixedFindings([finding("a", "$.x")])).toEqual(["a $.y", "b $.x"]);
  });

  it("counts a finding reported twice", () => {
    expect(baseline.newFindings([finding("a", "$.x"), finding("a", "$.x")])).toEqual(["a $.x"]);
  });

  it("drops the fixed lines and keeps the rest", () => {
    expect(baseline.shrunk([finding("a", "$.x"), finding("b", "$.x")])).toEqual(["a $.x", "b $.x"]);
  });

  it("never adds a finding it does not list", () => {
    expect(baseline.shrunk([finding("a", "$.x"), finding("c", "$.z")])).toEqual(["a $.x"]);
  });
});

describe("OpenAPI lint", () => {
  let findings: Finding[];
  let baseline: Baseline;

  beforeAll(async () => {
    findings = await lintSpec();
    baseline = await Baseline.load();
    if (process.env.UPDATE_LINT_BASELINE) {
      await baseline.shrink(findings);
      baseline = await Baseline.load();
    }
  }, LINT_TIMEOUT);

  it("finds nothing the baseline does not list", () => {
    expect(
      baseline.newFindings(findings),
      "fix these, or suppress them in vacuum-ignore.yaml",
    ).toEqual([]);
  });

  it("lists nothing in the baseline that is fixed", () => {
    expect(baseline.fixedFindings(findings), "remove these from vacuum-baseline.json").toEqual([]);
  });
});
