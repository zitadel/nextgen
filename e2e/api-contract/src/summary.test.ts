import { describe, expect, test } from "vitest";

import type { Baseline } from "./baseline";
import type { FamilyRun } from "./lane";
import { ContractSummary } from "./summary";

function run(failures: FamilyRun["failures"]): FamilyRun {
  return {
    family: "management",
    operations: ["GET /teams", "Stateful tests (management)"],
    expected: 1,
    accounting: { selected: 1, tested: 1, skipped: 0, errored: 0, unmatched: [] },
    exitCode: 1,
    log: "",
    complete: true,
    stopReason: "",
    errors: [],
    failures,
    seconds: 1,
  };
}

const baseline = {
  verdict: (operation: string, failures: { check: string }[]) => {
    return operation === "GET /teams" && failures.length > 0
      ? [`New failure: "${failures[0]?.check ?? ""}" (3 requests).`]
      : [];
  },
} as unknown as Baseline;

describe("ContractSummary", () => {
  test("says so when nothing broke", () => {
    expect(new ContractSummary([run([])], baseline).markdown()).toContain("API contract: passed");
  });

  test("names the operation, the check and how to reproduce", () => {
    const summary = new ContractSummary(
      [run([{ operation: "GET /teams", check: "Server error", count: 3 }])],
      baseline,
    );
    const page = summary.markdown();
    expect(page).toContain("`GET /teams` (management)");
    expect(page).toContain('New failure: "Server error"');
    expect(page).toContain("turbo run api-contract --filter=@zitadel/e2e");
  });

  test("annotates each problem for the check page", () => {
    const summary = new ContractSummary(
      [run([{ operation: "GET /teams", check: "Server error", count: 3 }])],
      baseline,
    );
    expect(summary.annotations()).toEqual([
      '::error title=API contract: GET /teams::New failure: "Server error" (3 requests).',
    ]);
  });
});
