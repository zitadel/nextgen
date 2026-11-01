import { describe, expect, it } from "vitest";

import { billableUsage, lastHours } from "./report-usage";

describe("the hours a usage report covers", () => {
  it("are the complete hours before the run, so a replayed run reports the same ones", () => {
    expect(lastHours("2026-10-29T10:42:00.000Z", 2)).toEqual([
      { start: "2026-10-29T08:00:00.000Z", end: "2026-10-29T09:00:00.000Z" },
      { start: "2026-10-29T09:00:00.000Z", end: "2026-10-29T10:00:00.000Z" },
    ]);
  });
});

it("keeps core analytics and retired policy meters out of Stripe", () => {
  const records = [
    "monthly_active_users",
    "api_requests",
    "policy_users",
    "retained_users_400d",
    "sso_users",
    "sms_messages_us_ca",
    "sms_messages_other",
  ].map((metric) => ({
    team_id: "team_a",
    metric,
    value: 1,
    at: "2026-11-01T00:00:00Z",
    identifier: `team_a:${metric}:hour`,
  }));
  expect(billableUsage(records)).toEqual([records[4], records[5]]);
});
