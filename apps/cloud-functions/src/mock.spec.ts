import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_MONTH, MOCK_TEAM, mockCount, mockSystems } from "./mock";
import { bill } from "./pricing/bill";
import { entitlementsFor } from "./pricing/catalog";
import { lastHours } from "./workflows/report-usage";

const OCTOBER = Date.parse("2026-10-01T00:00:00.000Z");
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the mock team's usage", () => {
  it("adds up to the month exactly, whether the month is cut into hours or days", () => {
    const byHour = lastHours("2026-11-01T00:00:00.000Z", 31 * 24).reduce(
      (sum, hour) =>
        sum + mockCount(20_000, "sso_users", Date.parse(hour.start), Date.parse(hour.end)),
      0,
    );
    let byDay = 0;
    for (let day = OCTOBER; day < OCTOBER + 31 * DAY; day += DAY) {
      byDay += mockCount(20_000, "sso_users", day, day + DAY);
    }
    expect([byHour, byDay]).toEqual([20_000, 20_000]);
  });

  it("brings users in over the month's first days, as they count when first seen, and activity evenly", () => {
    const fortnight = OCTOBER + 15 * DAY;
    const users = mockCount(20_000, "sso_users", OCTOBER, fortnight) / 20_000;
    const tokens = mockCount(600_000, "m2m_tokens", OCTOBER, fortnight) / 600_000;
    expect(users).toBeGreaterThan(0.7);
    expect(tokens).toBeLessThan(0.55);
  });

  it("shows the period so far until the first report, priced as Pro would bill it", async () => {
    vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
    const { stripe } = mockSystems();
    const billing = await stripe.overview(MOCK_TEAM);
    expect(billing.plan.id).toBe("free");
    expect(billing.estimate).toEqual({ plan: "pro", total_amount: 150_000, currency: "usd" });
    expect(billing.usage.find((line) => line.metric === "sso_users")).toMatchObject({
      used: 15_000,
      included: 1_000,
      amount: 140_000,
    });
  });

  it("prices what the hourly report sent once there is any", async () => {
    const { zitadel, stripe } = mockSystems();
    const sent: Record<string, number> = {};
    for (const hour of lastHours("2026-10-02T00:00:00.000Z", 24)) {
      const records = await zitadel.usage(hour);
      for (const { metric, value } of records) sent[metric] = (sent[metric] ?? 0) + value;
      await stripe.reportUsage(records);
    }
    const billing = await stripe.overview(MOCK_TEAM);
    expect(Object.fromEntries(billing.usage.map((line) => [line.metric, line.used]))).toEqual(sent);
    expect(billing.estimate.total_amount).toBe(bill({ counts: sent }).total_amount);
    expect(sent.sso_users).toBeLessThan(MOCK_MONTH.counts.sso_users ?? 0);
  });

  it("bills a team Stripe moved to Pro its base fee even without metered charges", async () => {
    const { zitadel, stripe } = mockSystems();
    await zitadel.applyEntitlements(MOCK_TEAM.id, entitlementsFor("pro"));
    const hour = { start: "2026-10-01T00:00:00.000Z", end: "2026-10-01T01:00:00.000Z" };
    await stripe.reportUsage(await zitadel.usage(hour));
    const billing = await stripe.overview(MOCK_TEAM);
    expect(billing.plan).toMatchObject({ id: "pro", minimum_amount: 10_000, credit_amount: 0 });
    expect(billing.estimate).toEqual({ plan: "pro", total_amount: 10_000, currency: "usd" });
  });
});
