import type { Plan } from "../contract";
import type { Entitlements } from "../ports";
import data from "./catalog.json";

/**
 * The proposed price list (root ADR 084 §6), as data: `catalog.json` holds the
 * plans, the meters and the lines billed on top, and `catalog.schema.json`
 * describes it. Every price the mock shows and `bill()` charges comes from
 * there, so a changed price changes one file. It is a proposal, not what
 * Stripe holds.
 */
export interface Catalog {
  version: string;
  currency: string;
  plans: {
    free: { event_retention_days: number };
    pro: { minimum: { amount: number; is_credit: boolean }; event_retention_days: number };
    enterprise: {
      minimum: { tiers_per_year: Record<string, number>; is_credit: boolean };
      event_retention_days: number;
    };
  };
  packages: Package[];
  meters: Meter[];
  licensed: Licensed[];
}

/** A price per unit past the allowance, in dollars. */
export interface PerUnit {
  model: "per_unit";
  unit_amount: number;
}

export type PackageId = "governance" | "compliance";

/** Packages are selected per account, never counted per user or policy. */
export interface Package {
  id: PackageId;
  label: string;
  pricing: "included_in_plan" | "quoted";
  scope: "account";
  plans: Plan["id"][];
  included_in: Plan["id"][];
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
  kind: "users" | "activity" | "gauge";
  /** Free per account and month, on every plan; `null` for a gauge. */
  allowance: number | null;
  /** `null` for a gauge, which is counted and never billed. */
  price: PerUnit | PerBand | null;
  /** The plans that may use it; every plan when unset. */
  plans?: Plan["id"][];
  /** Counts at most `at_most` users per connection or directory a month. */
  counted_per?: { key: "connection" | "directory"; at_most: number };
}

/** A recurring plan fee or an add-on billed separately from metered usage. */
export interface Licensed {
  id: string;
  label: string;
  amount: number | null;
  plans: Plan["id"][];
}

export const CATALOG = data as Catalog;

/** Allowances for paid integrations and consumption; core gauges are never entitlements. */
export function entitlementsFor(plan: Plan["id"], catalog: Catalog = CATALOG): Entitlements {
  const allowances: Record<string, number> = {};
  for (const meter of catalog.meters) {
    if (meter.price === null) continue;
    if (meter.plans && !meter.plans.includes(plan)) continue;
    allowances[meter.id] = meter.allowance ?? 0;
  }
  return { plan, allowances };
}
