import { describe, expect } from "vitest";

import { baseline, test } from "./fixtures";
import { ContractSummary } from "./summary";

describe("API contract", () => {
  test("Schemathesis ran to completion", ({ contract }) => {
    // 0: every check passed. 1: it found failures, which the test below judges.
    // Anything else is Schemathesis itself failing, and its output says why.
    for (const run of contract) {
      expect([0, 1], run.log).toContain(run.exitCode);
      expect(run.complete, `${run.name} stopped: ${run.stopReason}`).toBe(true);
      expect(run.errors).toEqual([]);
    }
  });

  test("Schemathesis tested every operation it was asked to", ({ contract }) => {
    for (const run of contract.filter((candidate) => {
      return candidate.counted;
    })) {
      expect(run.accounting, run.name).toEqual({
        selected: run.expected,
        tested: run.expected,
        skipped: 0,
        errored: 0,
        unmatched: [],
      });
    }
  });

  test("every failure belongs to an operation the spec has", ({ contract }) => {
    const orphans = contract.flatMap((run) => {
      const named = new Set(run.operations);
      return run.failures
        .filter((failure) => {
          return !named.has(failure.operation);
        })
        .map((failure) => {
          return `${failure.operation}: ${failure.check}`;
        });
    });
    expect(orphans).toEqual([]);
  });

  test("no operation breaks the API contract beyond known-failures.json", ({ contract }) => {
    const problems = new ContractSummary(contract, baseline).problems().map((problem) => {
      return `${problem.operation}: ${problem.findings.join(" ")}`;
    });
    expect(problems).toEqual([]);
  });

  test("known-failures.json names only operations the spec has", ({ contract }) => {
    const operations = contract.flatMap((run) => {
      return run.operations;
    });
    expect(baseline.unknownOperations(operations), "remove these from known-failures.json").toEqual(
      [],
    );
  });
});
