import { describe, expect, it } from "vitest";

import { type Usage, bill, meterLines } from "./bill";
import { CATALOG, entitlementsFor } from "./catalog";

/**
 * What a meter counted per connection or directory reports for `users`, one
 * number per connection or directory: at most the catalog's `at_most` of each.
 */
function counted(id: string, users: number[]): number {
  const most = CATALOG.meters.find((meter) => meter.id === id)?.counted_per?.at_most;
  if (!most) throw new Error(`${id} is not counted per connection or directory`);
  return users.reduce((sum, count) => sum + Math.min(count, most), 0);
}

const times = (n: number, users: number) => Array.from({ length: n }, () => users);

/**
 * The bills the pricing proposal quotes, in minor units: its stress test,
 * its example bills and its migration example. A changed price that moves one
 * shows here first.
 */
const QUOTED: [string, Usage, number][] = [
  ["a side project, 2k MAU", { counts: { monthly_active_users: 2_000 } }, 0],
  [
    "a B2C startup that requires MFA for 30k users and hides the mark",
    { counts: { monthly_active_users: 30_000, policy_users: 30_000 }, hide_mark: true },
    10_000,
  ],
  ["a B2C app past Free's sizing, 600k MAU", { counts: { monthly_active_users: 600_000 } }, 10_000],
  [
    "a B2C app with 200k bot checks",
    { counts: { monthly_active_users: 600_000, bot_checks: 200_000 } },
    39_800,
  ],
  [
    "a consumer app, 3M MAU, bands opted in",
    { counts: { monthly_active_users: 3_000_000 }, bands_opt_in: true },
    400_000,
  ],
  [
    "a B2B app with its first enterprise customers: 2 connections of 200 users, 1 directory",
    {
      counts: {
        monthly_active_users: 5_000,
        sso_users: counted("sso_users", [200, 200]),
        directory_users: counted("directory_users", [200]),
        policy_users: 5_000,
      },
    },
    0,
  ],
  [
    "a B2B app whose one customer brings 10k users on one connection",
    { counts: { monthly_active_users: 10_000, sso_users: counted("sso_users", [10_000]) } },
    0,
  ],
  [
    "a mid-market B2B SaaS: 50 connections of 200 users, MFA required",
    {
      counts: {
        monthly_active_users: 10_000,
        sso_users: counted("sso_users", times(50, 200)),
        policy_users: 10_000,
      },
    },
    90_000,
  ],
  [
    "a growing B2B SaaS: 20 connections of 1,000 users, MFA required",
    {
      counts: {
        monthly_active_users: 20_000,
        sso_users: counted("sso_users", times(20, 1_000)),
        policy_users: 20_000,
      },
    },
    142_000,
  ],
  [
    "a small-business SaaS: 100k users, MFA required, no SSO",
    { counts: { monthly_active_users: 100_000, policy_users: 100_000 } },
    18_000,
  ],
  [
    "an enterprise B2B app: 300 connections and 100 directories of 500 users, 400-day retention, a SIEM sink, priority support",
    {
      counts: {
        monthly_active_users: 200_000,
        sso_users: counted("sso_users", times(300, 500)),
        directory_users: counted("directory_users", times(100, 500)),
        policy_users: 400_000,
        retained_users_400d: 200_000,
      },
      event_sinks: 1,
      support_priority: true,
    },
    2_467_900,
  ],
  [
    "an M2M platform, 20M tokens",
    { counts: { monthly_active_users: 1_000, m2m_tokens: 20_000_000 } },
    19_000,
  ],
  [
    "a consumer app, 10M MAU, bands opted in",
    { counts: { monthly_active_users: 10_000_000 }, bands_opt_in: true },
    1_800_000,
  ],
  [
    "a migrating IdP customer: 200 connections of 500 users, two policies, 400-day retention",
    {
      counts: {
        monthly_active_users: 100_000,
        sso_users: counted("sso_users", times(200, 500)),
        policy_users: 200_000,
        retained_users_400d: 100_000,
      },
    },
    1_178_000,
  ],
];

describe("a month's bill", () => {
  it.each(QUOTED)("matches the proposal for %s", (_, usage, total) => {
    expect(bill(usage).total_amount).toBe(total);
  });

  it("is Free while every count stays within its allowance", () => {
    const month = bill({ counts: { monthly_active_users: 150_000, sso_users: 1_000 } });
    expect(month).toMatchObject({ plan: "free", reasons: [], total_amount: 0 });
  });

  it("bills Pro's minimum while usage is below it, since the minimum is credit", () => {
    const month = bill({ counts: { policy_users: 30_000 } });
    expect(month).toMatchObject({ plan: "pro", usage_amount: 4_000, total_amount: 10_000 });
  });

  it("bills the usage alone once it passes the minimum, never both", () => {
    const month = bill({ counts: { sso_users: 20_000 } });
    expect(month).toMatchObject({ usage_amount: 190_000, total_amount: 190_000 });
  });

  it("adds what is billed on top to the minimum, never drawing on its credit", () => {
    const month = bill({ counts: { policy_users: 30_000 }, support_priority: true });
    expect(month).toMatchObject({ on_top_amount: 99_900, total_amount: 109_900 });
  });

  it("needs Pro to stream events to a SIEM, billed on top per sink", () => {
    const month = bill({ counts: {}, event_sinks: 2 });
    expect(month.reasons).toContain("streams events to a SIEM");
    expect(month).toMatchObject({ plan: "pro", on_top_amount: 20_000, total_amount: 30_000 });
  });

  it("bills core users above 1M only once the owner opts in", () => {
    const month = bill({ counts: { monthly_active_users: 3_000_000 } });
    expect(month).toMatchObject({ plan: "pro", usage_amount: 0, total_amount: 10_000 });
  });

  it("needs Pro for managed delivery, which Free does not offer", () => {
    const month = bill({ counts: { email_users: 200, email_messages: 400 } });
    expect(month.plan).toBe("pro");
    expect(month.reasons).toContain("email_users is not on Free");
  });

  it("draws activity from its pool first: 5 emails per emailed user", () => {
    const lines = meterLines({ counts: { email_users: 1_000, email_messages: 7_000 } });
    expect(lines.find((line) => line.metric === "email_messages")).toMatchObject({
      included: 5_000,
      amount: 100,
    });
  });

  it("prices texts by the destination's band, 2 per texted user pooled", () => {
    const lines = meterLines({ counts: { sms_users_us_ca: 20_000, sms_messages_us_ca: 50_000 } });
    expect(lines).toEqual([expect.objectContaining({ metric: "sms_users_us_ca", amount: 75_000 })]);
  });

  it("refuses a band that has no price yet, rather than billing it nothing", () => {
    expect(() => meterLines({ counts: { sms_users_other: 1 } })).toThrow(/no price yet/);
  });
});

describe("the catalog", () => {
  it("names each meter once, so each is one Stripe meter", () => {
    const ids = CATALOG.meters.map((meter) => meter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pools activity only on meters that exist", () => {
    const ids = new Set(CATALOG.meters.map((meter) => meter.id));
    for (const meter of CATALOG.meters) {
      if (meter.pool_of) expect(ids.has(meter.pool_of)).toBe(true);
      if (meter.pool && meter.price?.model !== "per_band")
        expect(ids.has(meter.pool.meter)).toBe(true);
    }
  });

  it("gives every plan the same allowances, and managed delivery to Pro and Enterprise only", () => {
    const free = entitlementsFor("free").allowances;
    const pro = entitlementsFor("pro").allowances;
    expect(free).toMatchObject({
      sso_users: 1_000,
      directory_users: 1_000,
      policy_users: 10_000,
      authz_users: 100_000,
      bot_checks: 1_000,
    });
    expect(pro).toMatchObject({ sso_users: 1_000, policy_users: 10_000, email_users: 0 });
    expect(free).not.toHaveProperty("email_users");
    expect(pro).not.toHaveProperty("email_messages");
  });

  it("bills a connection or directory at most $75 a month, however many users it brings", () => {
    for (const id of ["sso_users", "directory_users"]) {
      const meter = CATALOG.meters.find((candidate) => candidate.id === id);
      const price = meter?.price?.model === "per_unit" ? meter.price.unit_amount : 0;
      expect((meter?.counted_per?.at_most ?? 0) * price).toBeCloseTo(75);
    }
  });

  it("sells Enterprise, which keeps 90 days, only the 400-day retention", () => {
    const pro = entitlementsFor("pro").allowances;
    const enterprise = entitlementsFor("enterprise").allowances;
    expect(pro).toMatchObject({ retained_users_90d: 0, retained_users_400d: 0 });
    expect(enterprise).not.toHaveProperty("retained_users_90d");
    expect(enterprise).toHaveProperty("retained_users_400d", 0);
  });
});
