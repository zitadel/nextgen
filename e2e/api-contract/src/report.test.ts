import { describe, expect, test } from "vitest";

import { SchemathesisReport } from "./report";

function report(overrides: object = {}): SchemathesisReport {
  return new SchemathesisReport({
    operations: { selected: 2, tested: 2, skipped: 0, errored: 0 },
    warnings: { unmatched_filter: [] },
    complete: true,
    failures: [],
    errors: [],
    ...overrides,
  });
}

describe("SchemathesisReport", () => {
  test("parses the JSON Schemathesis writes", () => {
    const parsed = SchemathesisReport.parse(
      JSON.stringify({
        complete: true,
        stop_reason: "completed",
        failures: [{ title: "Server error", count: 2, operations: ["POST /sessions"] }],
        errors: [],
      }),
    );

    expect(parsed.failures()).toEqual([
      { operation: "POST /sessions", check: "Server error", count: 2 },
    ]);
    expect(parsed.complete).toBe(true);
  });

  test("lists a failure under every operation it names", () => {
    const failures = report({
      failures: [{ title: "Use after free", count: 1, operations: ["POST /a", "GET /a/{id}"] }],
    }).failures();

    expect(failures.map((failure) => failure.operation)).toEqual(["GET /a/{id}", "POST /a"]);
  });

  test("merges the same check on the same operation and adds the counts", () => {
    const failures = report({
      failures: [
        { title: "Server error", count: 2, operations: ["POST /a"] },
        { title: "Server error", count: 3, operations: ["POST /a"] },
      ],
    }).failures();

    expect(failures).toEqual([{ operation: "POST /a", check: "Server error", count: 5 }]);
  });

  test("keeps different checks on one operation apart, in order", () => {
    const failures = report({
      failures: [
        { title: "b check", count: 1, operations: ["POST /a"] },
        { title: "a check", count: 1, operations: ["POST /a"] },
      ],
    }).failures();

    expect(failures.map((failure) => failure.check)).toEqual(["a check", "b check"]);
  });

  test("says why a run that did not finish stopped", () => {
    const stopped = report({ complete: false, stop_reason: "interrupted" });

    expect(stopped.complete).toBe(false);
    expect(stopped.stopReason).toBe("interrupted");
    expect(report().stopReason).toBe("unknown");
  });

  test("reports how many operations it selected and tested", () => {
    const partial = report({
      operations: { selected: 3, tested: 1, skipped: 1, errored: 1 },
      warnings: { unmatched_filter: ["getX"] },
    });

    expect(partial.accounting).toEqual({
      selected: 3,
      tested: 1,
      skipped: 1,
      errored: 1,
      unmatched: ['"getX"'],
    });
  });

  test("renders each error as text", () => {
    expect(report({ errors: [{ message: "boom" }] }).errors).toEqual(['{"message":"boom"}']);
  });
});
