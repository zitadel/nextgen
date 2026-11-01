import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type Catalog, type Licensed, type Meter, readCatalog } from "./catalog";
import { type Cell, compareGroups, lineCell, meterCell, PLANS } from "./compare";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function words(cell: Cell): string {
  return cell.kind === "text" ? [cell.text, ...(cell.notes ?? [])].join(" ") : cell.kind;
}

describe("the comparison of the cloud's price list", () => {
  const catalog = readCatalog(ROOT);
  const groups = compareGroups(catalog);
  const rows = groups.flatMap((group) => group.rows);

  it("places every meter and every line billed on top in a group, once", () => {
    expect(groups.map((group) => group.id)).not.toContain("other");
    const sources = rows.flatMap((row) => (row.source ? [row.source] : []));
    const expected = [
      ...catalog.meters.filter((meter) => !meter.pool_of).map((meter) => meter.id),
      ...catalog.licensed.filter((line) => line.tag !== "minimum spend").map((line) => line.id),
    ];
    expect([...sources].sort()).toEqual([...expected].sort());
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
  const catalog = { meters: [sso] } as Catalog;

  it("stops Free at the allowance and prices Pro past it", () => {
    expect(meterCell(sso, "free", catalog)).toEqual({ kind: "text", text: "1K / month included" });
    expect(meterCell(sso, "pro", catalog)).toEqual({
      kind: "text",
      text: "1K / month included",
      notes: ["Then $0.015 per user"],
    });
    expect(meterCell(sso, "enterprise", catalog)).toEqual({ kind: "text", text: "Custom" });
  });

  it("leaves out a plan the meter is not offered on", () => {
    expect(meterCell({ ...sso, plans: ["pro", "enterprise"] }, "free", catalog)).toEqual({
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
