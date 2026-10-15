import { describe, expect, it } from "vitest";

import { formatDateTime, formatRecent } from "./date";

describe("formatRecent", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("reads a moment within the last day against now", () => {
    expect(formatRecent("2026-10-15T06:00:00Z", now)).toBe("6h ago");
    expect(formatRecent("2026-10-15T11:48:00Z", now)).toBe("12m ago");
    expect(formatRecent("2026-10-15T11:59:30Z", now)).toBe("just now");
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
