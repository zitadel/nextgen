import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatEventDay, formatRecent } from "./date";

describe("formatRecent", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("reads a moment within the last day against now", () => {
    expect(formatRecent("2026-10-15T06:00:00Z", now)).toBe("6h ago");
    expect(formatRecent("2026-10-15T11:48:00Z", now)).toBe("12m ago");
    expect(formatRecent("2026-10-15T11:59:30Z", now)).toBe("just now");
    // Stamped by a server whose clock the browser trails.
    expect(formatRecent("2026-10-15T12:00:02Z", now)).toBe("just now");
  });

  it("reads anything older, or in the future, against the calendar", () => {
    const old = "2026-10-06T14:00:00Z";
    expect(formatRecent(old, now)).toBe(formatDateTime(old));
    const ahead = "2026-10-16T00:00:00Z";
    expect(formatRecent(ahead, now)).toBe(formatDateTime(ahead));
  });

  it("shows what arrived when it cannot be parsed", () => {
    expect(formatRecent("not a date", now)).toBe("not a date");
  });
});

describe("formatEventDay", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const yearless = (value: string) =>
    new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  it("leaves the year out of a day within eleven months, last year's included", () => {
    expect(formatEventDay("2026-10-06T14:00:00Z", now)).toBe(yearless("2026-10-06T14:00:00Z"));
    expect(formatEventDay("2025-12-28T14:00:00Z", now)).toBe(yearless("2025-12-28T14:00:00Z"));
    expect(formatEventDay("2026-10-06T14:00:00Z", now)).not.toContain("2026");
  });

  it("writes the year of a day further off, which the month alone would misplace", () => {
    const old = "2025-10-20T14:00:00Z";
    expect(formatEventDay(old, now)).toBe(formatDate(old));
    expect(formatEventDay(old, now)).toContain("2025");
  });

  it("shows what arrived when it cannot be parsed", () => {
    expect(formatEventDay("not a date", now)).toBe("not a date");
  });
});
