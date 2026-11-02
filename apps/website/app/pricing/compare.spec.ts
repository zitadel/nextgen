import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type Licensed, type Meter, readCatalog } from "./catalog";
import { type Cell, compareGroups, lineCell, meterCell, packageCell, PLANS } from "./compare";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function words(cell: Cell): string {
  return cell.kind === "text" ? [cell.text, ...(cell.notes ?? [])].join(" ") : cell.kind;
}

describe("the comparison of the cloud's price list", () => {
  const catalog = readCatalog(ROOT);
  const groups = compareGroups(catalog);
  const rows = groups.flatMap((group) => group.rows);

  it("places every meter, licensed line and package capability in a group, once", () => {
    expect(groups.map((group) => group.id)).not.toContain("other");
    const sources = rows.flatMap((row) => (row.source ? [row.source] : []));
    const expected = [
      ...catalog.meters.map((meter) => meter.id),
      ...catalog.licensed.filter((line) => line.tag !== "minimum spend").map((line) => line.id),
    ];
    expect([...sources].sort()).toEqual([...expected].sort());
    for (const entry of catalog.packages) {
      expect(rows.filter((row) => row.packageId === entry.id).map((row) => row.label)).toEqual(
        entry.features,
      );
    }
  });

  it("says something on every cell, and no price in Enterprise's column", () => {
    for (const row of rows) {
      for (const plan of PLANS) {
        expect(words(row.cells[plan]), `${row.label}, ${plan}`).not.toMatch(/undefined|NaN|null/);
      }
      expect(words(row.cells.enterprise), row.label).not.toMatch(/\$/);
    }
  });
});

describe("meterCell", () => {
  const sso: Meter = {
    id: "sso_users",
    label: "SSO users",
    kind: "users",
    counts: "",
    allowance: 1000,
    price: { model: "per_unit", unit_amount: 0.015 },
  };

  it("stops Free at the allowance and prices Pro past it", () => {
    expect(meterCell(sso, "free")).toEqual({ kind: "text", text: "1K / month included" });
    expect(meterCell(sso, "pro")).toEqual({
      kind: "text",
      text: "1K / month included",
      notes: ["Then $0.015 per user"],
    });
    expect(meterCell(sso, "enterprise")).toEqual({ kind: "text", text: "Custom" });
  });

  it("leaves out a plan the meter is not offered on", () => {
    expect(meterCell({ ...sso, plans: ["pro", "enterprise"] }, "free")).toEqual({
      kind: "no",
    });
  });
});

describe("lineCell", () => {
  const region: Licensed = {
    id: "region",
    label: "Region",
    amount: 100,
    interval: "month",
    per: "region",
    plans: ["pro"],
    included_in: ["enterprise"],
    tag: "compliance",
  };

  it("prices the plans that take it, and says Included where a plan has it", () => {
    expect(lineCell(region, "free")).toEqual({ kind: "no" });
    expect(lineCell(region, "pro")).toEqual({ kind: "text", text: "$100 a month per region" });
    expect(lineCell(region, "enterprise")).toEqual({ kind: "text", text: "Included" });
    expect(lineCell({ ...region, plans: ["enterprise"], included_in: [] }, "enterprise")).toEqual({
      kind: "text",
      text: "Custom",
    });
  });
});

describe("free security and account-wide packages", () => {
  const catalog = readCatalog(ROOT);
  const rows = compareGroups(catalog).flatMap((group) => group.rows);

  it("shows every core resource and security feature on Free", () => {
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
    for (const plan of PLANS) expect(words(mau!.cells[plan])).toBe("Never billed");
  });

  it("prices capacity steps and regions outside the EU on Pro, never on Free", () => {
    const capacity = rows.find((entry) => entry.source === "capacity_step")!;
    expect(capacity.cells.free.kind).toBe("no");
    expect(words(capacity.cells.pro)).toBe("$2,000 a month per step Adds 150M requests a month");
    expect(words(capacity.cells.enterprise)).toBe("Custom");
    const region = rows.find((entry) => entry.source === "region")!;
    expect(region.cells.free.kind).toBe("no");
    expect(words(region.cells.pro)).toBe("$100 a month per region");
    expect(words(region.cells.enterprise)).toBe("Included");
    const included = rows.find((entry) => entry.label === "Regions included")!;
    expect(PLANS.map((plan) => words(included.cells[plan]))).toEqual([
      "EU",
      "EU",
      "Every available region",
    ]);
  });

  it("reserves branding removal for paid plans", () => {
    const row = rows.find((entry) => entry.label === "Hide the Zitadel mark")!;
    expect(row.cells.free.kind).toBe("no");
    expect(row.cells.pro.kind).toBe("yes");
    expect(row.cells.enterprise.kind).toBe("yes");
  });

  it("quotes Enterprise support and agreements without offering custom terms on Pro", () => {
    const agreements = rows.find((entry) => entry.source === "addendum")!;
    expect(agreements.cells.free.kind).toBe("no");
    expect(agreements.cells.pro.kind).toBe("no");
    expect(words(agreements.cells.enterprise)).toBe("Custom");
    expect(words(rows.find((entry) => entry.source === "support_priority")!.cells.enterprise)).toBe(
      "Custom",
    );
  });

  it("includes Governance in Pro and requires a quote for Compliance", () => {
    const governance = catalog.packages.find((entry) => entry.id === "governance")!;
    const compliance = catalog.packages.find((entry) => entry.id === "compliance")!;
    expect(packageCell(governance, "free").kind).toBe("no");
    expect(words(packageCell(governance, "pro"))).toBe("Included Planned");
    expect(words(packageCell(compliance, "pro"))).toBe("Custom quote Planned");
    expect(words(packageCell(compliance, "enterprise"))).toBe("Custom quote Planned");
  });

  it("does not advertise Pro's availability target as a contractual SLA", () => {
    const row = rows.find((entry) => entry.label === "Availability commitment")!;
    expect(words(row.cells.pro)).toBe("99.9% target No service credits");
    expect(words(row.cells.enterprise)).toBe("99.95% SLA With service credits");
    expect(words(rows.find((entry) => entry.source === "sla_9995")!.cells.enterprise)).toBe(
      "Included",
    );
    expect(words(rows.find((entry) => entry.source === "sla_9999")!.cells.enterprise)).toBe(
      "Custom",
    );
  });
});
