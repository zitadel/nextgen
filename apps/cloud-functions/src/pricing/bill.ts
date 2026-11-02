import type { BillingEstimate, Plan } from "../contract";
import { CATALOG, type Catalog, type Meter, type PackageId } from "./catalog";

/**
 * One account's month as the meters count it: counts by Stripe event name, a
 * destination-priced meter's as `sms_messages_us_ca`, and what the account turned on.
 */
export interface Usage {
  counts: Record<string, number>;
  /** An owner-selected plan; usage alone never creates a subscription. */
  plan?: "free" | "pro";
  /** Branding removal requires Pro; Free keeps the mark. */
  hide_mark?: boolean;
  /** Regions outside the EU the account runs projects in, each a Pro add-on. */
  regions?: number;
  /** Quoted packages require a contract and cannot use the self-service estimator. */
  packages?: PackageId[];
  support_priority?: boolean;
}

/** One meter's month: what it counted, what of that is included, and the amount past it. */
export interface MeteredLine {
  /** The Stripe meter's event name. */
  metric: string;
  meter: Meter;
  used: number;
  /** Unset for a gauge, which bills nothing. */
  included?: number;
  /** Minor units. */
  amount: number;
}

/** A month's invoice at list prices, in minor units (root ADR 084 §6). */
export interface Bill {
  /** The lowest eligible plan, or the owner's selection. Enterprise is quoted. */
  plan: "free" | "pro";
  /** What needs a paid plan; empty on Free. */
  reasons: string[];
  lines: MeteredLine[];
  usage_amount: number;
  minimum_amount: number;
  on_top_amount: number;
  /** The base fee plus metered usage and add-ons. */
  total_amount: number;
}

const minor = (dollars: number): number => Math.round(dollars * 100);

/** Every meter the month counted something on, priced past its allowance. */
export function meterLines(usage: Usage, catalog: Catalog = CATALOG): MeteredLine[] {
  const count = (metric: string) => usage.counts[metric] ?? 0;
  const lines: MeteredLine[] = [];
  for (const meter of catalog.meters) {
    const price = meter.price;
    if (price?.model === "per_band") {
      for (const band of price.bands) {
        const metric = `${meter.id}_${band.id}`;
        const used = count(metric);
        if (used === 0) continue;
        if (band.unit_amount === null) throw new Error(`${metric} has no price yet`);
        const included = meter.allowance ?? 0;
        const amount = minor(Math.max(0, used - included) * band.unit_amount);
        lines.push({ metric, meter, used, included, amount });
      }
      continue;
    }
    const used = count(meter.id);
    if (used === 0) continue;
    if (price === null) {
      lines.push({ metric: meter.id, meter, used, amount: 0 });
      continue;
    }
    const included = meter.allowance ?? 0;
    const amount = minor(Math.max(0, used - included) * price.unit_amount);
    lines.push({ metric: meter.id, meter, used, included, amount });
  }
  return lines;
}

/**
 * The capacity steps a month's requests need past Pro's included volume.
 * Requests are never billed one by one: the owner adds steps, and the
 * estimate prices the ones the month needs.
 */
export function capacitySteps(usage: Usage, catalog: Catalog = CATALOG): number {
  const step = catalog.licensed.find((line) => line.id === "capacity_step");
  if (!step?.requests_per_month) return 0;
  const included = catalog.plans.pro.limits.requests_per_month_per_account;
  const past = Math.max(0, (usage.counts.api_requests ?? 0) - included);
  return Math.ceil(past / step.requests_per_month);
}

/**
 * The month's estimate: Free while nothing needs a paid plan, otherwise Pro's
 * base fee plus metered usage beyond allowances, the capacity steps the
 * month's requests need and selected add-ons.
 * This estimate never starts a subscription.
 */
export function bill(usage: Usage, catalog: Catalog = CATALOG): Bill {
  for (const id of usage.packages ?? []) {
    const selected = catalog.packages.find((entry) => entry.id === id);
    if (!selected) throw new Error(`Unknown package: ${id}`);
    if (selected.pricing === "quoted") {
      throw new Error(`${selected.label} requires a contract quote before activation`);
    }
  }
  const lines = meterLines(usage, catalog);
  const usageAmount = lines.reduce((sum, line) => sum + line.amount, 0);
  const steps = capacitySteps(usage, catalog);
  const reasons = paidReasons(usage, lines, usageAmount, steps, catalog);
  if (reasons.length === 0) {
    return {
      plan: "free",
      reasons,
      lines,
      usage_amount: 0,
      minimum_amount: 0,
      on_top_amount: 0,
      total_amount: 0,
    };
  }
  const price = (id: string) => minor(catalog.licensed.find((line) => line.id === id)?.amount ?? 0);
  const onTop =
    (usage.support_priority ? price("support_priority") : 0) +
    steps * price("capacity_step") +
    (usage.regions ?? 0) * price("region");
  const minimum = minor(catalog.plans.pro.minimum.amount);
  return {
    plan: "pro",
    reasons,
    lines,
    usage_amount: usageAmount,
    minimum_amount: minimum,
    on_top_amount: onTop,
    total_amount: minimum + usageAmount + onTop,
  };
}

/** Why the estimate uses a paid plan; it never creates a subscription. */
function paidReasons(
  usage: Usage,
  lines: MeteredLine[],
  usageAmount: number,
  steps: number,
  catalog: Catalog,
): string[] {
  const reasons: string[] = [];
  const requests = usage.counts.api_requests ?? 0;
  if (usageAmount > 0) reasons.push("usage past an allowance");
  if (steps > 0) {
    reasons.push(`${steps} capacity step${steps === 1 ? "" : "s"} past Pro's included requests`);
  } else if (requests > catalog.plans.free.limits.requests_per_month_per_account) {
    reasons.push("requests past Free's monthly ceiling");
  }
  if (usage.plan === "pro") reasons.push("Pro selected by the owner");
  if (usage.hide_mark) reasons.push("hides the Zitadel mark");
  if (usage.regions) reasons.push("runs in a region outside the EU");
  for (const id of new Set(usage.packages ?? [])) {
    const selected = catalog.packages.find((entry) => entry.id === id);
    if (selected && !selected.plans.includes("free")) reasons.push(`${selected.label} package`);
  }
  if (usage.support_priority) reasons.push("priority support");
  for (const line of lines) {
    if (line.meter.plans && !line.meter.plans.includes("free")) {
      reasons.push(`${line.metric} is not on Free`);
    }
  }
  return reasons;
}

/** Price the selected subscription; Free only shows the opt-in Pro estimate. */
export function estimateForPlan(month: Bill, plan: Plan): BillingEstimate {
  return {
    plan: plan.id === "free" ? month.plan : plan.id,
    total_amount:
      plan.id === "free"
        ? month.total_amount
        : plan.minimum_amount +
          Math.max(0, month.usage_amount - plan.credit_amount) +
          month.on_top_amount,
    currency: plan.currency,
  };
}
