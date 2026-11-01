import { describe, expect, it } from "vitest";

import type { DayCount } from "../ports";
import { meterLines } from "./bill";
import { periodSoFar, pricedDays } from "./days";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;
const count = (n: number, metric: string, value: number, project_id = "proj_a"): DayCount => ({
  day: day(n),
  project_id,
  metric,
  value,
});

describe("a day's price", () => {
  it("is nothing while the allowance lasts, then the marginal price", () => {
    const days = pricedDays([1, 2, 3].map((n) => count(n, "sso_users", 600)));
    expect(days.map(({ entries }) => entries.map((entry) => entry.amount))).toEqual([
      [0],
      [2_000],
      [6_000],
    ]);
  });

  it("adds up to the period's bill, pools and all", () => {
    const counts = [
      count(1, "sso_users", 900),
      count(1, "email_users", 100),
      count(1, "email_messages", 1_200),
      count(2, "sso_users", 700, "proj_b"),
      count(2, "email_users", 200, "proj_b"),
      count(3, "email_messages", 900),
      count(3, "m2m_tokens", 1_500_000),
    ];
    const total: Record<string, number> = {};
    for (const { metric, value } of counts) total[metric] = (total[metric] ?? 0) + value;
    const billed = meterLines({ counts: total }).reduce((sum, line) => sum + line.amount, 0);
    const priced = pricedDays(counts)
      .flatMap(({ entries }) => entries)
      .reduce((sum, entry) => sum + entry.amount, 0);
    expect(priced).toBe(billed);
  });

  it("splits a day between projects by their counts, in whole cents that add up", () => {
    const [first] = pricedDays([
      count(1, "sso_users", 1_401, "proj_a"),
      count(1, "sso_users", 400, "proj_b"),
      count(1, "sso_users", 202, "proj_c"),
    ]);
    const parts = first?.entries.map((entry) => entry.amount) ?? [];
    expect(parts.every(Number.isInteger)).toBe(true);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10_030);
  });
});

describe("the period so far", () => {
  const october = { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" };

  it("runs to the end of today, so today shows what it counted so far", () => {
    expect(periodSoFar(october, new Date("2026-10-15T12:00:00.000Z")).end).toBe(
      "2026-10-16T00:00:00.000Z",
    );
  });

  it("stops at the period's end", () => {
    expect(periodSoFar(october, new Date("2026-11-03T08:00:00.000Z")).end).toBe(october.end);
  });
});
