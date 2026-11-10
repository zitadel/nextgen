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

  it("shows the cards' three columns: Free, Add-ons and Enterprise", () => {
    expect(TIERS).toEqual(["free", "addons", "enterprise"]);
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

  it("gives every add-on that works today its own group with its base fee and meters, leaving its features to the add-on list", () => {
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

  it("names the lowest listed add-on that works today as where add-ons start", () => {
    expect(lowestHub(catalog)).toBe("$100");
  });
});

describe("meterCell", () => {
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

  it("says what is free, then what the add-on includes and costs past it", () => {
    expect(meterCell(social, "free")).toEqual({ kind: "text", text: "10K users / month" });
    expect(meterCell(social, "addons")).toEqual({
      kind: "text",
      text: "100K users / month included",
      notes: ["Then $0.004 per user"],
    });
    expect(meterCell(social, "enterprise")).toEqual({ kind: "text", text: "Custom" });
  });

  it("counts configured things without a month, and offers nothing under Free when nothing is free", () => {
    const sso: Meter = {
      ...social,
      id: "sso_connections",
      kind: "configured",
      unit: "connection",
      allowance: 2,
      free_allowance: 0,
      price: { model: "per_unit", unit_amount: 75 },
    };
    expect(meterCell(sso, "free")).toEqual({ kind: "no" });
    expect(meterCell(sso, "addons")).toEqual({
      kind: "text",
      text: "2 connections included",
      notes: ["Then $75 per connection"],
    });
  });

  it("keeps a meter only an add-on offers out of Free", () => {
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
    expect(meterCell(checks, "free")).toEqual({ kind: "no" });
    expect(meterCell(checks, "addons")).toEqual({
      kind: "text",
      text: "10K checks / month included",
      notes: ["Then $0.50 per 1,000 checks"],
    });
  });

  it("names the features a meter counts that don't work yet", () => {
    expect(meterCell(social, "enterprise", ["SAML SSO per team"])).toEqual({
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

  it("lists the base fee under Add-ons and folds it into Enterprise's commitment", () => {
    expect(hubBaseCell(hub, "free")).toEqual({ kind: "no" });
    expect(hubBaseCell(hub, "addons")).toEqual({ kind: "text", text: "$100 / month" });
    expect(words(hubBaseCell(hub, "enterprise"))).toBe("In the commitment");
  });

  it("quotes a hub only Enterprise takes", () => {
    const compliance: Hub = {
      ...hub,
      base: { amount: null, interval: "year" },
      pricing: "quoted",
      plans: ["enterprise"],
    };
    expect(hubBaseCell(compliance, "addons")).toEqual({ kind: "no" });
    expect(words(hubBaseCell(compliance, "enterprise"))).toBe("Custom quote");
  });

  it("prices an add-on still to come only once it is Coming next", () => {
    const later: Hub = { ...hub, id: "agentic", features: ["Consent for agents"] };
    expect(comingCell(later, "free")).toEqual({ kind: "no" });
    expect(words(comingCell(later, "addons"))).toBe(NOT_PRICED);
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

  it("prices a line under Add-ons, and says Included where Enterprise has it", () => {
    expect(lineCell(step, "free")).toEqual({ kind: "no" });
    expect(lineCell(step, "addons")).toEqual({ kind: "text", text: "$700 a month per step" });
    expect(lineCell(step, "enterprise")).toEqual({ kind: "text", text: "Included" });
    expect(lineCell({ ...step, plans: ["enterprise"], included_in: [] }, "addons")).toEqual({
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

  it("includes every core resource, sign-in method and protection in Free", () => {
    for (const feature of [
      ...catalog.core.resources,
      ...catalog.core.platform,
      ...catalog.core.authentication,
      ...catalog.core.security,
    ]) {
      const row = rows.find((entry) => entry.label === feature);
      expect(row, feature).toBeDefined();
      expect(row?.cells.free.kind, feature).not.toBe("no");
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
      expect(row.cells.free, label).toEqual({ kind: "no" });
      expect(row.cells.addons, label).toEqual({ kind: "yes" });
      expect(row.cells.enterprise, label).toEqual({ kind: "yes" });
    }
  });

  it("meters service tokens, authorization checks and log destinations for any add-on", () => {
    const usage = groups.find((group) => group.id === "usage")!.rows;
    const row = (id: string) => usage.find((entry) => entry.source === id)!;
    const cell = (id: string) => words(row(id).cells.addons);
    expect(words(row("m2m_tokens").cells.free)).toBe("1M tokens / month");
    expect(cell("m2m_tokens")).toBe("10M tokens / month included Then $10 per million tokens");
    expect(cell("siem_sinks")).toBe(
      "$100 per destination 1 destination included with Security Analytics",
    );
    expect(cell("custom_domains")).toBe("1 domain included Then $50 per domain");
  });

  it("lists compliance under Enterprise only", () => {
    for (const label of catalog.plans.enterprise.compliance) {
      const row = rows.find((entry) => entry.label === label)!;
      expect(row.cells.free.kind, label).toBe("no");
      expect(row.cells.addons.kind, label).toBe("no");
      expect(words(row.cells.enterprise), label).toBe("Included");
    }
  });

  it("names what every priced meter counts, so no cell shows a bare number", () => {
    for (const meter of catalog.meters.filter((entry) => entry.price !== null))
      expect(meter.unit, meter.id).toMatch(/^[a-z]+$/);
  });

  it("never bills API requests, only limits them, and sells capacity in steps", () => {
    const requests = rows.find((entry) => entry.label === "API requests")!;
    expect(words(requests.cells.free)).toBe("Never billed Up to 50 a second per project");
    expect(words(requests.cells.addons)).toBe("Never billed Up to 500 a second per project");
    expect(words(requests.cells.enterprise)).toBe("Custom");
    expect(words(rows.find((entry) => entry.source === "extra_capacity")!.cells.addons)).toBe(
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

  it("quotes Enterprise agreements without offering custom terms with an add-on", () => {
    const agreements = rows.find((entry) => entry.source === "addendum")!;
    expect(agreements.cells.addons.kind).toBe("no");
    expect(words(agreements.cells.enterprise)).toBe("Custom");
  });

  it("keeps priority support out of what any add-on includes, and says what its price buys", () => {
    const support = rows.find((entry) => entry.label === "Support")!;
    expect(words(support.cells.free)).toBe("Community");
    expect(words(support.cells.addons)).toBe("Tickets any time, answered the next business day");
    const priority = rows.find((entry) => entry.source === "support_priority")!;
    expect(words(priority.cells.addons)).toBe(
      "$999 a month A 1-hour response for outages and a 99.95% uptime SLA with service credits.",
    );
  });

  it("does not advertise the add-ons' availability target as a contractual SLA", () => {
    const row = rows.find((entry) => entry.label === "Uptime commitment")!;
    expect(row.cells.free).toEqual({ kind: "no" });
    expect(words(row.cells.addons)).toBe("99.9% target No service credits");
    expect(words(row.cells.enterprise)).toBe("99.95% SLA With service credits");
  });
});
