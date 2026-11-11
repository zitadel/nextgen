import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readCatalog } from "./catalog";
import { estimate } from "./estimate";
import { estimateInputs, QUESTIONS, sellable } from "./estimate-inputs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("the pricing page's calculator", () => {
  const catalog = readCatalog(ROOT);
  const inputs = estimateInputs(catalog);
  const bill = (usage: Record<string, number>) => estimate(inputs, usage);

  it("asks about every meter that can be bought today, and no other", () => {
    expect(inputs.map((input) => input.id)).toEqual(sellable(catalog).map(({ meter }) => meter.id));
    for (const id of Object.keys(QUESTIONS))
      expect(
        catalog.meters.map((meter) => meter.id),
        id,
      ).toContain(id);
  });

  it("takes every price from the catalog", () => {
    const social = inputs.find((input) => input.id === "social_users")!;
    expect(social).toMatchObject({
      free: 10_000,
      included: 100_000,
      unitAmount: 0.004,
      hub: { label: "Consumer Identity", base: 100 },
    });
    const sso = inputs.find((input) => input.id === "sso_connections")!;
    expect(sso).toMatchObject({
      free: 1,
      included: 2,
      unitAmount: 75,
      hub: { label: "Multi-Tenancy", base: 200 },
    });
  });

  it("bills nothing within the free amounts", () => {
    expect(bill({})).toEqual({ total: 0, lines: [] });
    expect(bill({ social_users: 10_000, sso_connections: 1 })).toEqual({ total: 0, lines: [] });
  });

  it("turns an add-on on past its free amount, for its base fee while usage is included", () => {
    expect(bill({ social_users: 50_000 })).toEqual({
      total: 100,
      lines: [{ hub: "Consumer Identity", amount: 100, sum: "$100" }],
    });
    expect(bill({ sso_connections: 2 }).total).toBe(200);
  });

  it("adds what runs past the included amount, and says how it adds up", () => {
    expect(bill({ social_users: 300_000 })).toEqual({
      total: 900,
      lines: [{ hub: "Consumer Identity", amount: 900, sum: "$100 + 200,000 × $0.004" }],
    });
    expect(bill({ sso_connections: 10 })).toEqual({
      total: 800,
      lines: [{ hub: "Multi-Tenancy", amount: 800, sum: "$200 + 8 × $75" }],
    });
  });

  it("stacks add-ons at full price", () => {
    const both = bill({ social_users: 300_000, sso_connections: 10 });
    expect(both.total).toBe(1700);
    expect(both.lines.map((line) => line.hub)).toEqual(["Consumer Identity", "Multi-Tenancy"]);
  });

  it("rounds to cents and ignores usage below zero", () => {
    expect(bill({ social_users: 100_001 }).total).toBe(100);
    expect(bill({ social_users: 100_010 }).total).toBe(100.04);
    expect(bill({ social_users: -5 }).total).toBe(0);
  });
});
