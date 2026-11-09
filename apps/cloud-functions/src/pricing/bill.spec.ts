import { describe, expect, it } from "vitest";

import { bill, meterLines } from "./bill";
import { CATALOG, entitlementsFor } from "./catalog";

describe("free core identity", () => {
  it.each([0, 200_000, 1_000_000, 10_000_000, 100_000_000])(
    "keeps %i active users free, with no hub on",
    (users) => {
      const month = bill({ counts: { monthly_active_users: users, api_requests: 1_000_000 } });
      expect(month).toMatchObject({ plan: "free", reasons: [], hubs: [], total_amount: 0 });
      expect(month.lines.every((line) => line.amount === 0)).toBe(true);
    },
  );

  it("keeps social sign-in free up to the free amount", () => {
    expect(bill({ counts: { social_users: 10_000 } })).toMatchObject({
      plan: "free",
      total_amount: 0,
    });
  });

  it("never charges for bot checks or legacy policy counts", () => {
    expect(bill({ counts: { bot_checks: 1_000_000, policy_users: 5_000_000 } })).toMatchObject({
      plan: "free",
      total_amount: 0,
    });
  });
});

describe("hubs", () => {
  it("turns on the Consumer hub past the free social users, with its included amount", () => {
    expect(bill({ counts: { social_users: 10_001 } })).toMatchObject({
      plan: "pro",
      hubs: [{ hub: "consumer", amount: 10_000 }],
      usage_amount: 0,
      total_amount: 10_000,
    });
  });

  it("prices social users past the Consumer hub's included amount", () => {
    // 400,000 social users: 300,000 past the hub's 100,000 at $0.004.
    expect(bill({ counts: { social_users: 400_000 } })).toMatchObject({
      usage_amount: 120_000,
      total_amount: 130_000,
    });
  });

  it("prices SSO per connection past Multi-Tenancy's two", () => {
    expect(bill({ counts: { sso_connections: 1 } }).total_amount).toBe(0);
    expect(bill({ counts: { sso_connections: 2 } })).toMatchObject({
      hubs: [{ hub: "multi_tenancy", amount: 20_000 }],
      total_amount: 20_000,
    });
    expect(bill({ counts: { sso_connections: 12 } }).total_amount).toBe(20_000 + 10 * 7_500);
  });

  it("charges branded teams past five, whichever UI shows them", () => {
    expect(bill({ counts: { branded_teams: 25 } })).toMatchObject({
      usage_amount: 20 * 500,
      total_amount: 20_000 + 20 * 500,
    });
  });

  it("stacks hubs at full price", () => {
    const month = bill({ counts: {}, hubs: ["consumer", "multi_tenancy", "agentic"] });
    expect(month.hubs.map((line) => line.hub)).toEqual(["consumer", "multi_tenancy", "agentic"]);
    expect(month.total_amount).toBe(10_000 + 20_000 + 10_000);
  });

  it("charges a hub once when it is turned on twice or also by usage", () => {
    expect(
      bill({ counts: { social_users: 50_000 }, hubs: ["consumer", "consumer"] }).total_amount,
    ).toBe(10_000);
  });

  it("keeps a free amount of delegation and meters it in the agentic hub", () => {
    expect(bill({ counts: { delegation_exchanges: 1_000 } }).total_amount).toBe(0);
    // 300,000 exchanges: 200,000 past the hub's 100,000 at $1 per 1,000.
    expect(bill({ counts: { delegation_exchanges: 300_000 } })).toMatchObject({
      hubs: [{ hub: "agentic" }],
      usage_amount: 20_000,
      total_amount: 30_000,
    });
  });

  it("includes five login themes in the Consumer hub, then charges each", () => {
    expect(bill({ counts: { brands: 1 } }).total_amount).toBe(0);
    expect(bill({ counts: { brands: 5 } })).toMatchObject({
      hubs: [{ hub: "consumer" }],
      usage_amount: 0,
    });
    expect(bill({ counts: { brands: 7 } }).usage_amount).toBe(2 * 500);
  });
});

describe("needs every hub shares", () => {
  it("turns on the default hub to hide the mark", () => {
    expect(bill({ counts: {}, hide_mark: true })).toMatchObject({
      plan: "pro",
      hubs: [{ hub: "consumer" }],
      reasons: ["hides the Zitadel mark"],
      total_amount: 10_000,
    });
  });

  it("adds managed email to whichever hub is on", () => {
    const month = bill({ counts: { email_messages: 7_000 }, hubs: ["multi_tenancy"] });
    expect(month).toMatchObject({ usage_amount: 350, total_amount: 20_350 });
    expect(month.hubs.map((line) => line.hub)).toEqual(["multi_tenancy"]);
  });

  it("prices managed texts by destination and message count", () => {
    expect(meterLines({ counts: { sms_messages_us_ca: 50_000 } })).toEqual([
      expect.objectContaining({ metric: "sms_messages_us_ca", used: 50_000, amount: 75_000 }),
    ]);
  });

  it("refuses an unpriced destination", () => {
    expect(() => meterLines({ counts: { sms_messages_other: 1 } })).toThrow(/no price yet/);
  });

  it("keeps service tokens and authorization checks free up to core's amount, then needs any hub", () => {
    expect(bill({ counts: { m2m_tokens: 1_000_000, authz_checks: 1_000_000 } }).total_amount).toBe(
      0,
    );
    // 20M tokens: 10M past what any hub includes, at $10 per million.
    expect(bill({ counts: { m2m_tokens: 20_000_000 } })).toMatchObject({
      hubs: [{ hub: "consumer" }],
      usage_amount: 10_000,
    });
    const business = bill({ counts: { m2m_tokens: 20_000_000 }, hubs: ["multi_tenancy"] });
    expect(business.hubs.map((line) => line.hub)).toEqual(["multi_tenancy"]);
    expect(business.usage_amount).toBe(10_000);
  });

  it("sells log destinations to any hub, with one included in Security Analytics", () => {
    expect(bill({ counts: { siem_sinks: 2 }, hubs: ["multi_tenancy"] }).usage_amount).toBe(
      2 * 10_000,
    );
    expect(bill({ counts: { siem_sinks: 2 }, hubs: ["security_analytics"] }).usage_amount).toBe(
      10_000,
    );
  });

  it("includes one custom domain with any hub, then charges each", () => {
    expect(bill({ counts: { custom_domains: 1 } })).toMatchObject({
      hubs: [{ hub: "consumer" }],
      usage_amount: 0,
    });
    expect(bill({ counts: { custom_domains: 3 }, hubs: ["multi_tenancy"] }).usage_amount).toBe(
      2 * 5_000,
    );
  });

  it("adds capacity steps and support on top of the base fees", () => {
    expect(
      bill({ counts: {}, hubs: ["consumer"], extra_capacity: 2, support_priority: true }),
    ).toMatchObject({ on_top_amount: 2 * 70_000 + 99_900, total_amount: 10_000 + 239_900 });
  });
});

describe("capacity and regions", () => {
  it("never bills requests, only the capacity an owner adds", () => {
    const month = bill({
      counts: { monthly_active_users: 10_000_000, api_requests: 1_300_000_000 },
    });
    expect(month).toMatchObject({ plan: "free", total_amount: 0 });
    expect(CATALOG.meters.map((meter) => meter.id)).not.toContain("api_requests");
  });

  it("lets every plan choose any available region at no charge", () => {
    const plans = CATALOG.plans as Record<string, { regions?: unknown }>;
    for (const plan of ["free", "pro", "enterprise"])
      expect(plans[plan]?.regions).toEqual({ scope: "project", selection: "all_available" });
    expect(CATALOG.licensed.map((line) => line.id)).not.toContain("region");
  });
});

describe("catalog entitlements", () => {
  it("says what every Enterprise commitment tier buys", () => {
    const { minimum, tiers } = CATALOG.plans.enterprise;
    expect(Object.keys(tiers)).toEqual(Object.keys(minimum.tiers_per_year));
    const amounts = Object.values(minimum.tiers_per_year);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it("never sends core users or bot checks as a billing allowance", () => {
    for (const plan of ["free", "pro", "enterprise"] as const) {
      const allowances = entitlementsFor(plan).allowances;
      for (const id of ["monthly_active_users", "policy_users", "bot_checks"])
        expect(allowances).not.toHaveProperty(id);
    }
  });

  it("sends the free amounts with no hub and the hubs' once paid", () => {
    expect(entitlementsFor("free").allowances).toMatchObject({
      social_users: 10_000,
      sso_connections: 1,
      delegation_exchanges: 1_000,
    });
    expect(entitlementsFor("free").allowances).not.toHaveProperty("email_messages");
    expect(entitlementsFor("pro").allowances).toMatchObject({
      social_users: 100_000,
      sso_connections: 2,
      email_messages: 0,
    });
  });

  it("gives every listed hub a base fee, none under the production basics' $100", () => {
    // Every hub carries the basics, so the cheapest one is what they cost.
    for (const hub of CATALOG.hubs) {
      if (hub.pricing === "listed") expect(hub.base.amount, hub.id).toBeGreaterThanOrEqual(100);
      else expect(hub.base.amount, hub.id).toBeNull();
    }
    for (const meter of CATALOG.meters) {
      if (meter.hub)
        expect(
          CATALOG.hubs.map((hub) => hub.id),
          meter.id,
        ).toContain(meter.hub);
    }
  });
});
