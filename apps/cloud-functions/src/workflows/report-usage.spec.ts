import { describe, expect, it } from "vitest";

import { lastHours } from "./report-usage";

describe("the hours a usage report covers", () => {
  it("are the complete hours before the run, so a replayed run reports the same ones", () => {
    expect(lastHours("2026-10-29T10:42:00.000Z", 2)).toEqual([
      { start: "2026-10-29T08:00:00.000Z", end: "2026-10-29T09:00:00.000Z" },
      { start: "2026-10-29T09:00:00.000Z", end: "2026-10-29T10:00:00.000Z" },
    ]);
  });
});
