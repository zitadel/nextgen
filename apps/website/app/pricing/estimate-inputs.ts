import { type Catalog, hubMeters } from "./catalog";
import type { EstimateInput } from "./estimate";
import { hubStatus, meterStatus, works } from "./status";

// What the calculator asks. Only the wording and the sliders' ranges are
// written here: every price, free amount and included amount comes from the
// catalog. It asks only about what can be bought today, so a meter that doesn't
// work yet, or whose add-on doesn't, is left out, like its price.

/** How the calculator asks for a meter's usage, by the meter's id in the catalog. */
export const QUESTIONS: Record<string, { question: string; max: number; step: number }> = {
  social_users: {
    question: "Users signing in with Google or another social login, a month",
    max: 1_000_000,
    step: 10_000,
  },
  sso_connections: {
    question: "Business customers signing in with their own SSO",
    max: 50,
    step: 1,
  },
};

/** The meters of the add-ons that work today, at least in part, each with its prices. */
export function sellable(catalog: Catalog) {
  return catalog.hubs
    .filter((hub) => hub.base.amount !== null && works(hubStatus(hub)))
    .flatMap((hub) =>
      hubMeters(catalog, hub.id)
        .filter((meter) => works(meterStatus(meter, catalog)))
        .map((meter) => ({ hub, meter })),
    );
}

/** The calculator's inputs, priced from the catalog. */
export function estimateInputs(catalog: Catalog): EstimateInput[] {
  return sellable(catalog).flatMap(({ hub, meter }): EstimateInput[] => {
    const asked = QUESTIONS[meter.id];
    if (!asked || meter.price?.model !== "per_unit" || hub.base.amount === null) return [];
    return [
      {
        id: meter.id,
        ...asked,
        free: meter.free_allowance ?? 0,
        included: meter.allowance ?? 0,
        unitAmount: meter.price.unit_amount,
        hub: { id: hub.id, label: hub.label, base: hub.base.amount },
      },
    ];
  });
}
