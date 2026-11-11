import { describe, expect, it } from "vitest";

import { CATALOG } from "./catalog";

// What Stripe needs from the price list, before anything syncs it there: every
// price a card pays names the Stripe price it becomes, and every meter the
// Stripe meter it reports to.
describe("the price list, ready for Stripe", () => {
  it("names a Stripe price for every listed base fee and line, and none for a quoted one", () => {
    for (const hub of CATALOG.hubs) {
      const listed = hub.pricing === "listed" && hub.base.amount !== null;
      expect(hub.stripe !== null, hub.id).toBe(listed);
    }
    for (const line of CATALOG.licensed) {
      const listed = line.amount !== null && line.plans.includes("pro");
      expect(line.stripe !== null, line.id).toBe(listed);
    }
  });

  it("names a Stripe meter for every priced meter, and none for a gauge", () => {
    for (const meter of CATALOG.meters) {
      expect(meter.stripe !== null, meter.id).toBe(meter.price !== null);
    }
  });

  it("keeps the last count of configured things and sums the rest", () => {
    for (const meter of CATALOG.meters) {
      if (meter.stripe === null) continue;
      expect(meter.stripe.aggregation, meter.id).toBe(meter.kind === "configured" ? "last" : "sum");
    }
  });

  it("gives every Stripe price its own lookup key", () => {
    const keys = [
      ...CATALOG.hubs.map((hub) => hub.stripe?.price_lookup_key),
      ...CATALOG.licensed.map((line) => line.stripe?.price_lookup_key),
      ...CATALOG.meters.map((meter) => meter.stripe?.price_lookup_key),
    ].filter((key) => key !== undefined);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
