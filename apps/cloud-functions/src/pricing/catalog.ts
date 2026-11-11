import type { Plan } from "../contract";
import type { Entitlements } from "../ports";
import data from "./catalog.json";

/**
 * The proposed price list (root ADR 084 §6), as data: `catalog.json` holds the
 * plans, the hubs, the meters and the lines billed on top, and
 * `catalog.schema.json` describes it. Every price the mock shows and `bill()`
 * charges comes from there, so a changed price changes one file. It is a
 * proposal, not what Stripe holds.
 */
export interface Catalog {
  version: string;
  currency: string;
  plans: {
    free: { event_retention_days: number };
    pro: {
      minimum: { amount: number; is_credit: boolean };
      event_retention_days: number;
    };
    enterprise: {
      minimum: { tiers_per_year: Record<string, number>; is_credit: boolean };
      /** What each commitment tier buys; `null` while not set. */
      tiers: Record<
        string,
        { support_response: string | null; sla_percent: number; tam_hours_per_week: number | null }
      >;
      event_retention_days: number;
    };
  };
  /** The hub the estimate turns on for a paid need no single hub owns. */
  default_hub: HubId;
  hubs: Hub[];
  meters: Meter[];
  licensed: Licensed[];
}

export type HubId =
  | "consumer"
  | "multi_tenancy"
  | "agentic"
  | "security_analytics"
  | "extensibility";

/**
 * The Stripe price a flat price becomes, found by its lookup key; `null` while
 * it is quoted. Nothing creates these in Stripe yet.
 */
export type StripePrice = { price_lookup_key: string } | null;

/** The Stripe meter a metered price reports to; `null` for a gauge. */
export type StripeMeter = {
  event_name: string;
  /** `sum` for counted activity or new users, `last` for configured things. */
  aggregation: "sum" | "last";
  price_lookup_key: string;
} | null;

/** A hub is turned on per account for a monthly base fee; hubs stack at full price. */
export interface Hub {
  id: HubId;
  label: string;
  /** `null` when the hub is quoted. */
  base: { amount: number | null; interval: string };
  pricing: "listed" | "quoted";
  plans: Plan["id"][];
  stripe: StripePrice;
}

/** A price per unit past the allowance, in dollars. */
export interface PerUnit {
  model: "per_unit";
  unit_amount: number;
}

/** A consumption price by destination. Unpriced destinations require a quote. */
export interface PerBand {
  model: "per_band";
  bands: { id: string; unit_amount: number | null }[];
}

export interface Meter {
  /** Also the Stripe meter's event name; a banded meter's is `<id>_<band>`. */
  id: string;
  label: string;
  kind: "users" | "activity" | "configured" | "gauge";
  /** Included once the meter's hub is on (any hub, for a shared meter); `null` for a gauge. */
  allowance: number | null;
  /** A shared meter's included amount where a particular hub is on, when that hub includes more. */
  hub_allowance?: Partial<Record<HubId, number>>;
  /** Free on Pay as you go before its hub is on; `null` when only a hub offers it. */
  free_allowance: number | null;
  /** `null` for a gauge, which is counted and never billed. */
  price: PerUnit | PerBand | null;
  /** The hub that sells it; `null` for a gauge or a meter every hub offers. */
  hub: HubId | null;
  /** The plans that may use it; every plan when unset. */
  plans?: Plan["id"][];
  stripe: StripeMeter;
}

/** A recurring fee or an add-on billed separately from metered usage. */
export interface Licensed {
  id: string;
  label: string;
  amount: number | null;
  plans: Plan["id"][];
  stripe: StripePrice;
}

export const CATALOG = data as Catalog;

/**
 * Allowances per meter. An account with no hub sends the free amounts; a paid one sends what
 * the hubs include, as if each meter's hub is on. Gauges are never entitlements.
 */
export function entitlementsFor(plan: Plan["id"], catalog: Catalog = CATALOG): Entitlements {
  const allowances: Record<string, number> = {};
  for (const meter of catalog.meters) {
    if (meter.price === null) continue;
    if (meter.plans && !meter.plans.includes(plan)) continue;
    const allowance = plan === "free" ? meter.free_allowance : meter.allowance;
    if (allowance === null) continue;
    allowances[meter.id] = allowance;
  }
  return { plan, allowances };
}
