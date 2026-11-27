import { describe, expect, it } from "vitest";

import { formatDate } from "./date";
import {
  clearedFilters,
  dateFilterLabel,
  dateFilterStart,
  type FilterDefinition,
  isFiltered,
  parseDateFilter,
  today,
} from "./resource-filter";

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

describe("a screen's filters as a whole", () => {
  const filters: FilterDefinition[] = [
    { type: "options", key: "kind", label: "Kind", options: [] },
    { type: "date", key: "picked", label: "Picked" },
  ];

  it("is filtered once any of them is set, whatever else the search carries", () => {
    expect(isFiltered(filters, { q: "pear" })).toBe(false);
    expect(isFiltered(filters, { picked: "7d" })).toBe(true);
  });

  it("clears every one of them, and nothing else", () => {
    expect(clearedFilters(filters)).toEqual({ kind: undefined, picked: undefined });
    expect(Object.keys(clearedFilters(filters))).toEqual(["kind", "picked"]);
  });
});
