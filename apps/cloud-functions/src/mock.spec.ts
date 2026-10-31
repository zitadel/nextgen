import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_TEAM, hourShare, mockSystems } from "./mock";
import { entitlementsFor } from "./pricing/catalog";
import { lastHours } from "./workflows/report-usage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the mock team's usage", () => {
  it("spreads a month's count over its hours, adding up to it exactly", () => {
    const october = lastHours("2026-11-01T00:00:00.000Z", 31 * 24);
    expect(october[0]?.start).toBe("2026-10-01T00:00:00.000Z");
    expect(october.reduce((sum, hour) => sum + hourShare(20_000, hour), 0)).toBe(20_000);
  });

  it("shows the month it is built from until the first report, priced as Pro would bill it", async () => {
    const { stripe } = mockSystems();
    const billing = await stripe.overview(MOCK_TEAM);
    expect(billing.plan.id).toBe("free");
    expect(billing.estimate).toEqual({ plan: "pro", total_amount: 30_500, currency: "usd" });
    expect(billing.usage.find((line) => line.metric === "sso_users")).toMatchObject({
      used: 20_000,
      included: 1_000,
      amount: 28_500,
    });
  });

  it("prices what the hourly report sent once there is any", async () => {
    const { zitadel, stripe } = mockSystems();
    for (const hour of lastHours("2026-10-02T00:00:00.000Z", 24)) {
      await stripe.reportUsage(await zitadel.usage(hour));
    }
    const billing = await stripe.overview(MOCK_TEAM);
    expect(billing.usage.map((line) => [line.metric, line.used])).toEqual([
      ["monthly_active_users", 648],
      ["sso_users", 648],
      ["policy_users", 648],
    ]);
    expect(billing.estimate).toEqual({ plan: "free", total_amount: 0, currency: "usd" });
  });

  it("bills a team Stripe moved to Pro at least the plan's minimum", async () => {
    const { zitadel, stripe } = mockSystems();
    await zitadel.applyEntitlements(MOCK_TEAM.id, entitlementsFor("pro"));
    const hour = { start: "2026-10-01T00:00:00.000Z", end: "2026-10-01T01:00:00.000Z" };
    await stripe.reportUsage(await zitadel.usage(hour));
    const billing = await stripe.overview(MOCK_TEAM);
    expect(billing.plan).toMatchObject({ id: "pro", minimum_amount: 10_000 });
    expect(billing.estimate).toEqual({ plan: "pro", total_amount: 10_000, currency: "usd" });
  });
});
