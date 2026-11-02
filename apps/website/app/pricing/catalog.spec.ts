import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  type Licensed,
  licensedPrice,
  listedMeters,
  type Meter,
  meterPrice,
  readCatalog,
  regionList,
} from "./catalog";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function meter(fields: Partial<Meter>): Meter {
  return { id: "m", label: "M", kind: "users", counts: "", allowance: 0, price: null, ...fields };
}

describe("the cloud's price list", () => {
  const catalog = readCatalog(ROOT);

  it("prices every meter the page lists, in words", () => {
    const listed = listedMeters(catalog);
    expect(listed.length).toBeGreaterThan(0);
    for (const each of listed) {
      const lines = meterPrice(each);
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
    expect(free.limits.requests_per_month_per_account).toBeGreaterThan(0);
    expect(pro.limits.requests_per_second_per_project).toBeGreaterThan(0);
    expect(pro.limits.requests_per_month_per_account).toBeGreaterThan(
      free.limits.requests_per_month_per_account,
    );
    const step = catalog.licensed.find((line) => line.id === "capacity_step");
    expect(step?.requests_per_month).toBeGreaterThan(0);
    expect(free.regions).toEqual({ scope: "project", selection: ["eu"] });
    expect(pro.regions).toEqual({ scope: "project", selection: ["eu"] });
    expect(enterprise.regions).toEqual({ scope: "project", selection: "all_available" });
    expect(catalog.core.authentication).toContain("Passkeys and TOTP MFA");
    expect(pro.minimum.amount).toBeGreaterThan(0);
    expect(catalog.packages.map((entry) => entry.id)).toEqual(["governance", "compliance"]);
    expect(enterprise.support).not.toBe("");
    expect(catalog.self_hosted.pro.prices.length).toBeGreaterThan(0);
  });
});

describe("meterPrice", () => {
  it("never prices the core active-user gauge", () => {
    const mau = readCatalog(ROOT).meters.find((entry) => entry.id === "monthly_active_users");
    expect(mau).toBeDefined();
    expect(meterPrice(mau!)).toEqual(["Never billed"]);
    expect(listedMeters(readCatalog(ROOT)).map((entry) => entry.id)).not.toContain(
      "monthly_active_users",
    );
  });

  it("says what a connection costs at most, for a meter counted per connection", () => {
    const sso = meter({
      price: { model: "per_unit", unit_amount: 0.1 },
      counted_per: { key: "connection", at_most: 750 },
    });
    expect(meterPrice(sso)).toEqual(["$0.10 per user", "At most $75 per connection a month"]);
  });

  it("prices each destination band, or says it is not priced yet", () => {
    const sms = meter({
      price: {
        model: "per_band",
        bands: [
          { id: "us_ca", countries: ["US", "CA"], unit_amount: 0.015 },
          { id: "other", countries: [], unit_amount: null },
        ],
      },
    });
    expect(meterPrice(sms)).toEqual([
      "United States and Canada: $0.015 per message",
      "Other countries: quote required",
    ]);
  });
});

describe("regionList", () => {
  it("names a plan's regions, or every available one", () => {
    expect(regionList(["eu"])).toBe("EU");
    expect(regionList(["eu", "ch"])).toBe("EU and CH");
    expect(regionList("all_available")).toBe("Every available region");
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
    expect(licensedPrice(line({ amount: 100, per: "region" }))).toBe("$100 a month per region");
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
