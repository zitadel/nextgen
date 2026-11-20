import { beforeAll, describe, expect, it } from "vitest";

import { Baseline, type Finding, lintSpec } from "./openapi-lint";

/** A first run pulls the image before it lints. */
const LINT_TIMEOUT = 600_000;

describe("OpenAPI lint", () => {
  let findings: Finding[];
  let baseline: Baseline;

  beforeAll(async () => {
    findings = await lintSpec();
    if (process.env.UPDATE_LINT_BASELINE) {
      await Baseline.write(findings);
    }
    baseline = await Baseline.load();
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
