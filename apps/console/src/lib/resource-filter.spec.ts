import { describe, expect, it } from "vitest";

import { formatDate } from "./date";
import { dateFilterLabel, dateFilterStart, parseDateFilter, today } from "./resource-filter";

describe("date filter values", () => {
  it("keeps a range or a real day, and nothing else", () => {
    expect(parseDateFilter("7d")).toBe("7d");
    expect(parseDateFilter("2026-11-01")).toBe("2026-11-01");
    expect(parseDateFilter("2026-02-31")).toBeUndefined();
    expect(parseDateFilter("yesterday")).toBeUndefined();
    // The router reads a bare number in the URL as one.
    expect(parseDateFilter(7)).toBeUndefined();
  });

  it("starts a range counted back from now, and a day at its first local moment", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(dateFilterStart("24h", now)?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(dateFilterStart("30d", now)?.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(dateFilterStart("2026-11-01", now)).toEqual(new Date(2026, 10, 1));
    expect(dateFilterStart("nonsense", now)).toBeUndefined();
  });

  it("says a value in words", () => {
    expect(dateFilterLabel("7d")).toBe("Last 7 days");
    expect(dateFilterLabel("2026-11-01")).toBe(
      `Since ${formatDate(new Date(2026, 10, 1).toISOString())}`,
    );
  });

  it("writes today as a date field holds it", () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
