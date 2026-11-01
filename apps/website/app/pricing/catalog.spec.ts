import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  type Catalog,
  type Licensed,
  licensedPrice,
  listedMeters,
  type Meter,
  meterPrice,
  readCatalog,
} from "./catalog";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A catalog holding only `meters`, which is all meterPrice reads of it. */
function withMeters(meters: Meter[]): Catalog {
  return { meters } as Catalog;
}

function meter(fields: Partial<Meter>): Meter {
  return { id: "m", label: "M", kind: "users", counts: "", allowance: 0, price: null, ...fields };
}

describe("the cloud's price list", () => {
  const catalog = readCatalog(ROOT);

  it("prices every meter the page lists, in words", () => {
    const listed = listedMeters(catalog);
    expect(listed.length).toBeGreaterThan(0);
    for (const each of listed) {
      const lines = meterPrice(each, catalog);
      expect(lines.length, each.id).toBeGreaterThan(0);
      for (const line of lines) expect(line, each.id).not.toMatch(/undefined|NaN|null/);
    }
  });

  it("prices every line billed on top", () => {
    for (const line of catalog.licensed) {
      expect(licensedPrice(line), line.id).not.toMatch(/undefined|NaN|null/);
    }
  });

  it("has what the plan cards read", () => {
    const { free, pro, enterprise } = catalog.plans;
    expect(free.limits.core_mau_sized_for).toBeGreaterThan(0);
    expect(pro.minimum.amount).toBeGreaterThan(0);
    expect(pro.annual.amount).toBeGreaterThan(0);
    expect(enterprise.support).not.toBe("");
    expect(catalog.self_hosted.pro.prices.length).toBeGreaterThan(0);
  });
});

describe("meterPrice", () => {
  it("prices a user once, or once per policy", () => {
    const sso = meter({ price: { model: "per_unit", unit_amount: 0.015 } });
    expect(meterPrice(sso, withMeters([sso]))).toEqual(["$0.015 per user"]);
    const policy = meter({ dedupe: ["project", "user", "policy", "month"], price: sso.price });
    expect(meterPrice(policy, withMeters([policy]))).toEqual(["$0.015 per user and policy"]);
  });

  it("adds the pool and what past it costs", () => {
    const checks = meter({
      id: "authz_checks",
      label: "Authorization checks past the pool",
      kind: "activity",
      pool_of: "authz_users",
      price: { model: "per_unit", unit_amount: 0.000002, display: "$2 per million" },
    });
    const users = meter({
      id: "authz_users",
      pool: { meter: "authz_checks", per_user: 1000 },
      price: { model: "per_unit", unit_amount: 0.005 },
    });
    const catalog = withMeters([users, checks]);
    expect(meterPrice(users, catalog)).toEqual([
      "$0.005 per user",
      "1,000 authorization checks pooled per user, then $2 per million",
    ]);
    expect(listedMeters(catalog)).toEqual([users]);
  });

  it("prices bands, and says when they need an opt-in", () => {
    const mau = meter({
      price: { model: "bands", above: 1e6, size: 1e6, amount: 2000, until: 1e7, opt_in: true },
    });
    expect(meterPrice(mau, withMeters([mau]))).toEqual([
      "$2,000 per started 1M users above 1M, up to 10M",
      "Billed only after the owner opts in",
    ]);
  });

  it("prices each destination band, or says it is not priced yet", () => {
    const sms = meter({
      pool: { meter: "sms_messages", per_user: 2 },
      price: {
        model: "per_band",
        bands: [
          { id: "us_ca", countries: ["US", "CA"], per_user: 0.03, extra_message: 0.015 },
          { id: "other", countries: [], per_user: null, extra_message: null },
        ],
      },
    });
    expect(meterPrice(sms, withMeters([sms]))).toEqual([
      "$0.03 per user",
      "United States and Canada, 2 texts pooled per user, then $0.015 a text",
      "Other countries: not priced yet",
    ]);
  });
});

describe("licensedPrice", () => {
  const line = (fields: Partial<Licensed>): Licensed => ({
    id: "l",
    label: "L",
    amount: 0,
    interval: "month",
    plans: ["pro"],
    tag: "support",
    ...fields,
  });

  it("names the interval and what it is per", () => {
    expect(licensedPrice(line({ amount: 50, per: "domain" }))).toBe("$50 a month per domain");
    expect(licensedPrice(line({ amount: 250, interval: "hour" }))).toBe("$250 an hour");
  });

  it("lists no price for a line only Enterprise takes", () => {
    expect(licensedPrice(line({ amount: 800, plans: ["enterprise"] }))).toBe(
      "In the Enterprise quote",
    );
    expect(licensedPrice(line({ amount: 1000, plans: ["pro", "enterprise"] }))).toBe(
      "$1,000 a month",
    );
  });

  it("falls back to the note when there is no amount", () => {
    expect(licensedPrice(line({ amount: null, note: "cost plus margin" }))).toBe(
      "cost plus margin",
    );
  });
});
