import { describe, expect, it } from "vitest";

import { bill, meterLines } from "./bill";
import { CATALOG, entitlementsFor } from "./catalog";

describe("free core identity", () => {
  it.each([0, 200_000, 200_001, 1_000_000, 1_000_001, 3_000_000, 10_000_000, 100_000_000])(
    "keeps %i active users free, without an upgrade reason",
    (users) => {
      const month = bill({ counts: { monthly_active_users: users, api_requests: 1_000_000 } });
      expect(month).toMatchObject({ plan: "free", reasons: [], usage_amount: 0, total_amount: 0 });
      expect(month.lines.every((line) => line.amount === 0)).toBe(true);
    },
  );

  it("keeps Free within its monthly request ceiling and estimates Pro past it", () => {
    const ceiling = CATALOG.plans.free.limits.requests_per_month_per_account;
    expect(bill({ counts: { api_requests: ceiling } })).toMatchObject({
      plan: "free",
      total_amount: 0,
    });
    expect(bill({ counts: { api_requests: ceiling + 1 } })).toMatchObject({
      plan: "pro",
      reasons: ["requests past Free's monthly ceiling"],
      total_amount: 10_000,
    });
  });

  it("never charges legacy policy or retained-user counts, including basic require-MFA", () => {
    const month = bill({
      counts: {
        monthly_active_users: 1_000_000,
        policy_users: 5_000_000,
        retained_users_400d: 1_000_000,
      },
    });
    expect(month).toMatchObject({ plan: "free", reasons: [], total_amount: 0 });
  });
});

describe("paid packages", () => {
  it("requires Pro for branding removal even with no metered usage", () => {
    expect(bill({ counts: {}, hide_mark: true })).toMatchObject({
      plan: "pro",
      reasons: ["hides the Zitadel mark"],
      total_amount: 10_000,
    });
  });

  it("prices Governance once per account regardless of users or policy evaluations", () => {
    for (const count of [0, 1_000, 1_000_000]) {
      const month = bill({
        counts: { monthly_active_users: count, policy_users: count * 5 },
        packages: ["governance"],
      });
      expect(month).toMatchObject({
        plan: "pro",
        reasons: ["Governance package"],
        usage_amount: 0,
        total_amount: 10_000,
      });
    }
  });

  it("keeps an owner-selected Pro plan even with no metered usage", () => {
    expect(bill({ counts: {}, plan: "pro" }).total_amount).toBe(10_000);
  });

  it("does not charge twice when Governance is included in Pro or selected twice", () => {
    expect(
      bill({ counts: {}, plan: "pro", packages: ["governance", "governance"] }).total_amount,
    ).toBe(10_000);
  });

  it("refuses to estimate an unquoted Compliance package as free", () => {
    expect(() => bill({ counts: {}, packages: ["compliance"] })).toThrow(
      /Compliance requires a contract quote/,
    );
  });
});

describe("integrations and consumption", () => {
  it("keeps integration evaluation allowances and basic MFA free", () => {
    expect(
      bill({ counts: { monthly_active_users: 150_000, sso_users: 1_000, directory_users: 1_000 } }),
    ).toMatchObject({ plan: "free", total_amount: 0 });
  });

  it("adds usage to the Pro base fee, including when Governance is selected", () => {
    expect(bill({ counts: { sso_users: 1_200 }, packages: ["governance"] })).toMatchObject({
      usage_amount: 2_000,
      total_amount: 12_000,
    });
    expect(bill({ counts: { sso_users: 20_000 }, packages: ["governance"] })).toMatchObject({
      usage_amount: 190_000,
      total_amount: 200_000,
    });
  });

  it("prices twenty capped SSO connections without a basic-MFA surcharge", () => {
    expect(
      bill({ counts: { monthly_active_users: 20_000, sso_users: 20 * 750 } }).total_amount,
    ).toBe(150_000);
  });

  it("adds support to the base fee", () => {
    expect(bill({ counts: {}, packages: ["governance"], support_priority: true })).toMatchObject({
      on_top_amount: 99_900,
      total_amount: 109_900,
    });
  });

  it("prices managed email by messages, not recipients", () => {
    const month = bill({ counts: { email_messages: 7_000 } });
    expect(month).toMatchObject({ plan: "pro", usage_amount: 350, total_amount: 10_350 });
    expect(month.reasons).toContain("email_messages is not on Free");
  });

  it("prices managed texts by destination and message count", () => {
    expect(meterLines({ counts: { sms_messages_us_ca: 50_000 } })).toEqual([
      expect.objectContaining({ metric: "sms_messages_us_ca", used: 50_000, amount: 75_000 }),
    ]);
  });

  it("refuses an unpriced destination", () => {
    expect(() => meterLines({ counts: { sms_messages_other: 1 } })).toThrow(/no price yet/);
  });
});

describe("capacity and regions", () => {
  const included = CATALOG.plans.pro.limits.requests_per_month_per_account;

  it("adds a capacity step for each part of Pro's included volume a month goes past", () => {
    expect(bill({ counts: { api_requests: included } }).total_amount).toBe(10_000);
    expect(bill({ counts: { api_requests: included + 1 } })).toMatchObject({
      reasons: ["1 capacity step past Pro's included requests"],
      on_top_amount: 200_000,
      total_amount: 210_000,
    });
    expect(bill({ counts: { api_requests: 3 * included } }).total_amount).toBe(410_000);
  });

  it("prices a consumer app at scale by its requests, never by its users", () => {
    // Ten million users at the pricing proposal's 130 requests each a month.
    const month = bill({
      counts: { monthly_active_users: 10_000_000, api_requests: 1_300_000_000 },
    });
    expect(month).toMatchObject({ plan: "pro", usage_amount: 0, total_amount: 1_610_000 });
  });

  it("charges each region outside the EU on Pro", () => {
    expect(bill({ counts: {}, regions: 2 })).toMatchObject({
      plan: "pro",
      reasons: ["runs in a region outside the EU"],
      on_top_amount: 20_000,
      total_amount: 30_000,
    });
  });
});

describe("catalog entitlements", () => {
  it("never sends core users or policy counts as a billing allowance", () => {
    for (const plan of ["free", "pro", "enterprise"] as const) {
      const allowances = entitlementsFor(plan).allowances;
      for (const id of [
        "monthly_active_users",
        "policy_users",
        "retained_users_90d",
        "retained_users_400d",
      ])
        expect(allowances).not.toHaveProperty(id);
    }
  });

  it("keeps integration allowances and restricts managed delivery to paid plans", () => {
    expect(entitlementsFor("free").allowances).toMatchObject({
      sso_users: 1_000,
      directory_users: 1_000,
      bot_checks: 1_000,
    });
    expect(entitlementsFor("free").allowances).not.toHaveProperty("email_messages");
    expect(entitlementsFor("pro").allowances).toHaveProperty("email_messages", 0);
  });

  it("caps a connection or directory at $75 before the shared allowance", () => {
    for (const id of ["sso_users", "directory_users"]) {
      const meter = CATALOG.meters.find((candidate) => candidate.id === id);
      const price = meter?.price?.model === "per_unit" ? meter.price.unit_amount : 0;
      expect((meter?.counted_per?.at_most ?? 0) * price).toBeCloseTo(75);
    }
  });
});
