import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseRedirectTarget, RedirectTargetError } from "./redirect-target.js";

/**
 * One row of the list the server's own tests read
 * (`internal/httputil/redirect_test.go`), so the mock refuses what the server
 * refuses. A new input goes into the JSON file, which both suites read, not
 * into this file.
 */
interface Row {
  name: string;
  raw: string;
  repeat?: { unit: string; count: number };
  rawAfter?: string;
  host?: string;
  why?: string;
}

const rows = JSON.parse(
  readFileSync(
    new URL("../../../apps/api/internal/httputil/testdata/redirect_targets.json", import.meta.url),
    "utf8",
  ),
) as { accepts: Row[]; refuses: Row[] };

function targetOf(row: Row): string {
  if (!row.repeat) return row.raw;
  return row.raw + row.repeat.unit.repeat(row.repeat.count) + (row.rawAfter ?? "");
}

describe("parseRedirectTarget", () => {
  it.each(rows.accepts.map((row) => [row.name, row] as const))("accepts %s", (_name, row) => {
    const parsed = parseRedirectTarget(targetOf(row));

    expect(parsed.origin.split("://")[1]).toBe(row.host);
  });

  it.each(rows.refuses.map((row) => [row.name, row] as const))("refuses %s", (_name, row) => {
    expect(() => parseRedirectTarget(targetOf(row))).toThrow(RedirectTargetError);
    expect(() => parseRedirectTarget(targetOf(row))).toThrow(row.why as string);
  });

  it("writes a stray percent sign as an escape, as the server stores it", () => {
    expect(parseRedirectTarget("https://app.test/50%off#100%").href).toBe(
      "https://app.test/50%25off#100%25",
    );
  });

  it("folds the scheme and keeps the path and query as written", () => {
    expect(parseRedirectTarget("HTTPS://app.test/a%2Fb/%2e%2e/c?next=%2Fprofile#/step").href).toBe(
      "https://app.test/a%2Fb/%2e%2e/c?next=%2Fprofile#/step",
    );
  });
});
