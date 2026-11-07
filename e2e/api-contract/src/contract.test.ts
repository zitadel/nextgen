import { join } from "node:path";

import { describe, expect, inject, test } from "vitest";

import { Baseline } from "./baseline";

const families = inject("contractRuns");
const baseline = new Baseline(join(import.meta.dirname, "..", "known-failures.json"));

describe.each(families)("API contract: $family", (run) => {
  test("Schemathesis ran to completion", () => {
    // 0: every check passed. 1: it found failures, which the tests below judge.
    // Anything else is Schemathesis itself failing, and its output says why.
    expect([0, 1], run.log).toContain(run.exitCode);
    expect(run.complete, `stopped: ${run.stopReason}`).toBe(true);
    expect(run.errors).toEqual([]);
  });

  test("Schemathesis tested every operation it was asked to", () => {
    expect(run.accounting).toEqual({
      selected: run.expected,
      tested: run.expected,
      skipped: 0,
      errored: 0,
      unmatched: [],
    });
  });

  test("every failure belongs to a test below", () => {
    const named = new Set(run.operations);
    const orphans = run.failures
      .filter((failure) => {
        return !named.has(failure.operation);
      })
      .map((failure) => {
        return `${failure.operation}: ${failure.check}`;
      });
    expect(orphans).toEqual([]);
  });

  test.each(run.operations)("%s", (operation) => {
    const problems = baseline.verdict(
      operation,
      run.failures.filter((failure) => {
        return failure.operation === operation;
      }),
    );
    expect(problems, `${operation} breaks the API contract`).toEqual([]);
  });
});

describe("API contract", () => {
  test("known-failures.json names only operations the spec has", () => {
    const operations = families.flatMap((run) => {
      return run.operations;
    });
    expect(baseline.unknownOperations(operations), "remove these from known-failures.json").toEqual(
      [],
    );
  });
});
