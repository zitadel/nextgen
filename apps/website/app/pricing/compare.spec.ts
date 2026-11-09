import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type Hub, hubMeters, type Licensed, type Meter, readCatalog } from "./catalog";
import {
  type Cell,
  comingCell,
  compareGroups,
  hubBaseCell,
  lineCell,
  lowestHub,
  meterCell,
  NOT_PRICED,
  PLATFORM_DETAILS,
  TIERS,
} from "./compare";
import { hubStatus, METER_FEATURES, works } from "./status";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function words(cell: Cell): string {
  return cell.kind === "text" ? [cell.text, ...(cell.notes ?? [])].join(" ") : cell.kind;
}

describe("the comparison of the cloud's price list", () => {
  const catalog = readCatalog(ROOT);
  const groups = compareGroups(catalog);
  const rows = groups.flatMap((group) => group.rows);

  it("shows two tiers: Pay as you go and Enterprise", () => {
    expect(TIERS).toEqual(["payg", "enterprise"]);
  });

  it("places every meter, licensed line and hub in a group, once, but an unpriced add-on's meters", () => {
    expect(groups.map((group) => group.id)).not.toContain("other");
    const sources = rows.flatMap((row) => (row.source ? [row.source] : []));
    const unpriced = catalog.hubs
      .filter((hub) => !works(hubStatus(hub)))
      .flatMap((hub) => hubMeters(catalog, hub.id).map((meter) => meter.id));
    const expected = [
      ...catalog.meters.map((meter) => meter.id).filter((id) => !unpriced.includes(id)),
      ...catalog.licensed.map((line) => line.id),
      ...catalog.hubs.map((hub) => hub.id),
    ];
    expect([...sources].sort()).toEqual([...expected].sort());
  });

  it("lists an add-on still to come once, under What's coming, without a price", () => {
    const coming = groups.find((group) => group.id === "coming")!;
    for (const hub of catalog.hubs.filter((entry) => !works(hubStatus(entry)))) {
      expect(groups.map((group) => group.id)).not.toContain(`hub-${hub.id}`);
      const row = coming.rows.find((entry) => entry.source === hub.id)!;
      expect(row.status, hub.id).toBe(hubStatus(hub));
      for (const tier of TIERS) expect(words(row.cells[tier]), hub.id).not.toMatch(/\$/);
    }
  });

  it("gives every add-on that works today its own group with its base fee and meters, leaving its features to its card", () => {
    for (const hub of catalog.hubs.filter((entry) => works(hubStatus(entry)))) {
      const group = groups.find((entry) => entry.id === `hub-${hub.id}`);
      expect(group, hub.id).toBeDefined();
      const labels = group!.rows.map((row) => row.label);
      for (const feature of hub.features) expect(labels, hub.id).not.toContain(feature);
      for (const meter of catalog.meters.filter((entry) => entry.hub === hub.id))
        expect(
          group!.rows.map((row) => row.source),
          hub.id,
        ).toContain(meter.id);
    }
  });

  it("says something on every cell, and no price in Enterprise's column", () => {
    for (const row of rows) {
      for (const tier of TIERS) {
        expect(words(row.cells[tier]), `${row.label}, ${tier}`).not.toMatch(/undefined|NaN|null/);
      }
      expect(words(row.cells.enterprise), row.label).not.toMatch(/\$/);
    }
  });

  it("names the lowest listed add-on that works today as the price on top of Pay as you go", () => {
    expect(lowestHub(catalog)).toBe("$100");
  });
});

describe("meterCell", () => {
  const consumer: Hub = {
    id: "consumer",
    label: "Consumer Identity",
    line: "",
    base: { amount: 100, interval: "month" },
    pricing: "listed",
    plans: ["pro", "enterprise"],
    features: [],
  };
  const social: Meter = {
    id: "social_users",
    label: "Social users",
    kind: "users",
    unit: "user",
    counts: "",
    allowance: 100_000,
    free_allowance: 10_000,
    hub: "consumer",
    price: { model: "per_unit", unit_amount: 0.004 },
  };

  it("leads with the free amount, then what the hub includes and costs past it", () => {
    expect(meterCell(social, "payg", consumer)).toEqual({
      kind: "text",
      text: "10K users / month free",
      notes: ["With the add-on: 100K users / month, then $0.004 per user"],
    });
    expect(meterCell(social, "enterprise", consumer)).toEqual({ kind: "text", text: "Custom" });
  });

  it("counts configured things without a month, and says the hub includes them when nothing is free", () => {
    const sso: Meter = {
      ...social,
      id: "sso_connections",
      kind: "configured",
      unit: "connection",
      allowance: 2,
      free_allowance: 0,
      price: { model: "per_unit", unit_amount: 75 },
    };
    expect(meterCell(sso, "payg")).toEqual({
      kind: "text",
      text: "2 connections with the add-on",
      notes: ["Then $75 per connection"],
    });
  });

  it("says a meter of no add-on in particular is included, leaving when to its group", () => {
    const checks: Meter = {
      ...social,
      id: "verified_bot_checks",
      kind: "activity",
      unit: "check",
      allowance: 10_000,
      free_allowance: null,
      hub: null,
      price: { model: "per_unit", unit_amount: 0.0005, display: "$0.50 per 1,000 checks" },
    };
    expect(meterCell(checks, "payg")).toEqual({
      kind: "text",
      text: "10K checks / month included",
      notes: ["Then $0.50 per 1,000 checks"],
    });
  });

  it("names the features a meter counts that don't work yet", () => {
    expect(meterCell(social, "enterprise", consumer, ["SAML SSO per team"])).toEqual({
      kind: "text",
      text: "Custom",
      notes: ["Not yet: SAML SSO per team"],
    });
  });
});

describe("hub cells", () => {
  const hub: Hub = {
    id: "consumer",
    label: "Consumer Identity",
    line: "",
    base: { amount: 100, interval: "month" },
    pricing: "listed",
    plans: ["pro", "enterprise"],
    features: ["Social login at scale"],
  };

  it("lists the base fee on Pay as you go and folds it into Enterprise's commitment", () => {
    expect(hubBaseCell(hub, "payg")).toEqual({ kind: "text", text: "$100 / month" });
    expect(words(hubBaseCell(hub, "enterprise"))).toBe("In the commitment");
  });

  it("quotes a hub only Enterprise takes", () => {
    const compliance: Hub = {
      ...hub,
      base: { amount: null, interval: "year" },
      pricing: "quoted",
      plans: ["enterprise"],
    };
    expect(hubBaseCell(compliance, "payg")).toEqual({ kind: "no" });
    expect(words(hubBaseCell(compliance, "enterprise"))).toBe("Custom quote");
  });

  it("prices an add-on still to come only once it is Coming next", () => {
    const later: Hub = { ...hub, id: "agentic", features: ["Consent for agents"] };
    expect(words(comingCell(later, "payg"))).toBe(NOT_PRICED);
    expect(words(comingCell(later, "enterprise"))).toBe("In the commitment");
  });
});

describe("lineCell", () => {
  const step: Licensed = {
    id: "extra_capacity",
    label: "Extra capacity",
    amount: 700,
    interval: "month",
    per: "step",
    plans: ["pro"],
    included_in: ["enterprise"],
    tag: "capacity",
  };

  it("prices Pay as you go, and says Included where Enterprise has it", () => {
    expect(lineCell(step, "payg")).toEqual({ kind: "text", text: "$700 a month per step" });
    expect(lineCell(step, "enterprise")).toEqual({ kind: "text", text: "Included" });
    expect(lineCell({ ...step, plans: ["enterprise"], included_in: [] }, "payg")).toEqual({
      kind: "no",
    });
    expect(lineCell({ ...step, plans: ["enterprise"], included_in: [] }, "enterprise")).toEqual({
      kind: "text",
      text: "Custom",
    });
  });
});

describe("what every account includes and what any hub adds", () => {
  const catalog = readCatalog(ROOT);
  const groups = compareGroups(catalog);
  const rows = groups.flatMap((group) => group.rows);

  it("includes every core resource, sign-in method and protection in Pay as you go", () => {
    for (const feature of [
      ...catalog.core.resources,
      ...catalog.core.platform,
      ...catalog.core.authentication,
      ...catalog.core.security,
    ]) {
      const row = rows.find((entry) => entry.label === feature);
      expect(row, feature).toBeDefined();
      expect(row?.cells.payg.kind, feature).not.toBe("no");
    }
    const mau = rows.find((row) => row.source === "monthly_active_users");
    for (const tier of TIERS) expect(words(mau!.cells[tier])).toBe("Never billed");
  });

  it("says what comes with any add-on, a metered basic as its meter's row", () => {
    const shared = groups.find((group) => group.id === "every-hub")!.rows;
    const usage = groups.find((group) => group.id === "usage")!.rows;
    for (const label of catalog.hub_includes) {
      const meter = Object.entries(METER_FEATURES).find(([, labels]) => labels.includes(label));
      if (meter) {
        expect(
          usage.map((row) => row.source),
          label,
        ).toContain(meter[0]);
        expect(shared.map((row) => row.label)).not.toContain(label);
        continue;
      }
      const row = shared.find((entry) => entry.label === label)!;
      for (const tier of TIERS) expect(row.cells[tier], label).toEqual({ kind: "yes" });
    }
  });

  it("meters service tokens, authorization checks and log destinations for any add-on", () => {
    const usage = groups.find((group) => group.id === "usage")!.rows;
    const cell = (id: string) => words(usage.find((row) => row.source === id)!.cells.payg);
    expect(cell("m2m_tokens")).toBe(
      "1M tokens / month free With any add-on: 10M tokens / month, then $10 per million tokens",
    );
    expect(cell("siem_sinks")).toBe(
      "$100 per destination 1 destination included with Security Analytics",
    );
    expect(cell("custom_domains")).toBe("1 domain included Then $50 per domain");
  });

  it("lists compliance under Enterprise only", () => {
    for (const label of catalog.plans.enterprise.compliance) {
      const row = rows.find((entry) => entry.label === label)!;
      expect(row.cells.payg.kind, label).toBe("no");
      expect(words(row.cells.enterprise), label).toBe("Included");
    }
  });

  it("names what every priced meter counts, so no cell shows a bare number", () => {
    for (const meter of catalog.meters.filter((entry) => entry.price !== null))
      expect(meter.unit, meter.id).toMatch(/^[a-z]+$/);
  });

  it("never bills API requests, only limits them, and sells capacity in steps", () => {
    const requests = rows.find((entry) => entry.label === "API requests")!;
    expect(words(requests.cells.payg)).toBe(
      "Never billed Up to 50 a second per project, 500 with any add-on",
    );
    expect(words(requests.cells.enterprise)).toBe("Custom");
    expect(words(rows.find((entry) => entry.source === "extra_capacity")!.cells.payg)).toBe(
      "$700 a month per step",
    );
    const region = rows.find((entry) => entry.label === "Region, chosen per project")!;
    for (const tier of TIERS) expect(words(region.cells[tier])).toBe("Every available region");
  });

  it("explains platform rows by labels the catalog still has", () => {
    const labels = catalog.core.platform;
    for (const label of Object.keys(PLATFORM_DETAILS)) expect(labels).toContain(label);
    const releases = rows.find((row) => row.label.startsWith("Versioned releases"));
    expect(releases?.detail).toMatch(/schemas.*flows.*branding/);
  });

  it("quotes Enterprise agreements without offering custom terms on Pay as you go", () => {
    const agreements = rows.find((entry) => entry.source === "addendum")!;
    expect(agreements.cells.payg.kind).toBe("no");
    expect(words(agreements.cells.enterprise)).toBe("Custom");
  });

  it("does not advertise Pay as you go's availability target as a contractual SLA", () => {
    const row = rows.find((entry) => entry.label === "Uptime commitment")!;
    expect(words(row.cells.payg)).toBe("99.9% target With any add-on No service credits");
    expect(words(row.cells.enterprise)).toBe("99.95% SLA With service credits");
  });
});
