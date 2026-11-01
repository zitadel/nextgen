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
    free: { limits: { core_mau_sized_for: number }; event_retention_days: number };
    pro: { minimum: { amount: number }; event_retention_days: number };
    enterprise: {
      minimum: { tiers_per_year: Record<string, number> };
      event_retention_days: number;
    };
  };
  meters: Meter[];
  licensed: Licensed[];
}

/** A price per unit past the allowance, in dollars. */
export interface PerUnit {
  model: "per_unit";
  unit_amount: number;
}

/** A flat amount per started `size` above `above`, up to `until`. */
export interface Bands {
  model: "bands";
  above: number;
  size: number;
  amount: number;
  until: number;
  /** Bills only once the account's owner opts in. */
  opt_in: boolean;
}

/** A price per user and per extra message, by the destination's band. */
export interface PerBand {
  model: "per_band";
  bands: Band[];
}

export interface Band {
  id: string;
  /** `null` until the band is priced. */
  per_user: number | null;
  extra_message: number | null;
}

export interface Meter {
  /** Also the Stripe meter's event name; a banded meter's is `<id>_<band>`. */
  id: string;
  label: string;
  kind: "users" | "activity" | "gauge";
  /** Free per account and month, on every plan; `null` for a gauge. */
  allowance: number | null;
  /** `null` for a gauge, which is counted and never billed. */
  price: PerUnit | Bands | PerBand | null;
  /** Activity included per counted user, pooled across the account. */
  pool?: { meter: string; per_user: number };
  /** The user meter whose pool this activity draws on first. */
  pool_of?: string;
  /** The plans that may use it; every plan when unset. */
  plans?: Plan["id"][];
  /** How long a counted user's audit events are kept: a plan that keeps them as long has it already. */
  retention_days?: number;
  /** Counts at most `at_most` users per connection or directory a month. */
  counted_per?: { key: "connection" | "directory"; at_most: number };
}

/** A line billed on top of the minimum, never drawn from its credit. */
export interface Licensed {
  id: string;
  label: string;
  amount: number | null;
  plans: Plan["id"][];
}

export const CATALOG = data as Catalog;

/**
 * What a plan may use and the allowances the server enforces (root ADR 084
 * §6, §8.3): every billed meter the plan offers, at its allowance. Activity
 * drawn from a pool is billed past the pool and never enforced, so it is left
 * out, and so is a retention the plan keeps anyway.
 */
export function entitlementsFor(plan: Plan["id"], catalog: Catalog = CATALOG): Entitlements {
  const allowances: Record<string, number> = {};
  const keeps = catalog.plans[plan].event_retention_days;
  for (const meter of catalog.meters) {
    if (meter.price === null || meter.pool_of) continue;
    if (meter.plans && !meter.plans.includes(plan)) continue;
    if (meter.retention_days && meter.retention_days <= keeps) continue;
    allowances[meter.id] = meter.allowance ?? 0;
  }
  return { plan, allowances };
}
