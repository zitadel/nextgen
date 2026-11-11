import type { BillingEstimate, Plan } from "../contract";
import { CATALOG, type Catalog, type HubId, type Meter } from "./catalog";

/**
 * One account's month as the meters count it: counts by Stripe event name, a
 * destination-priced meter's as `sms_messages_us_ca`, and what the account turned on.
 */
export interface Usage {
  counts: Record<string, number>;
  /** Hubs an owner turned on; usage past the free amount turns on its hub in the estimate. */
  hubs?: HubId[];
  /** Hiding the mark needs a hub, any hub. */
  hide_mark?: boolean;
  /** Capacity steps an owner added. */
  extra_capacity?: number;
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

/** A hub's base fee on the month's bill. */
export interface HubLine {
  hub: HubId;
  label: string;
  /** Minor units. */
  amount: number;
}

/** A month's invoice at list prices, in minor units (root ADR 084 §6). */
export interface Bill {
  /** Free while no hub is on; Enterprise is quoted. */
  plan: "free" | "pro";
  /** Why a hub is on; empty while free. */
  reasons: string[];
  hubs: HubLine[];
  lines: MeteredLine[];
  usage_amount: number;
  /** The hubs' base fees. */
  minimum_amount: number;
  on_top_amount: number;
  /** Base fees plus metered usage and add-ons. */
  total_amount: number;
}

const minor = (dollars: number): number => Math.round(dollars * 100);

/** The metric names a meter counts under: one, or one per destination band. */
function metrics(meter: Meter): { metric: string; unit_amount: number | null }[] {
  const { price } = meter;
  if (price?.model === "per_band") {
    return price.bands.map((band) => ({
      metric: `${meter.id}_${band.id}`,
      unit_amount: band.unit_amount,
    }));
  }
  return [{ metric: meter.id, unit_amount: price?.unit_amount ?? null }];
}

/** Whether a meter's paid allowance applies: its hub is on, or any hub for a shared meter. */
function hubOn(meter: Meter, on: Set<HubId>): boolean {
  return meter.hub === null ? on.size > 0 : on.has(meter.hub);
}

/** What a meter includes: the free amount while its hub is off, then the hub's, or more where a hub that is on includes more. */
function includedAmount(meter: Meter, on: Set<HubId>): number {
  if (!hubOn(meter, on)) return meter.free_allowance ?? 0;
  const more = Object.entries(meter.hub_allowance ?? {}).flatMap(([hub, amount]) =>
    on.has(hub as HubId) ? [amount] : [],
  );
  return Math.max(meter.allowance ?? 0, ...more);
}

/**
 * Every meter the month counted something on, priced past its allowance:
 * the free amount while the meter's hub is off, the hub's once it is on.
 */
export function meterLines(
  usage: Usage,
  catalog: Catalog = CATALOG,
  on: Set<HubId> = hubsOn(usage, catalog).on,
): MeteredLine[] {
  const lines: MeteredLine[] = [];
  for (const meter of catalog.meters) {
    for (const { metric, unit_amount } of metrics(meter)) {
      const used = usage.counts[metric] ?? 0;
      if (used === 0) continue;
      if (meter.price === null) {
        lines.push({ metric, meter, used, amount: 0 });
        continue;
      }
      if (unit_amount === null) throw new Error(`${metric} has no price yet`);
      const included = includedAmount(meter, on);
      const amount = minor(Math.max(0, used - included) * unit_amount);
      lines.push({ metric, meter, used, included, amount });
    }
  }
  return lines;
}

/**
 * The hubs the month needs: those an owner turned on, plus the hub of every
 * meter past the free amount. A paid need no single hub owns (a shared meter
 * such as managed delivery or service tokens, the mark, capacity, support)
 * turns on the default hub when none is.
 */
export function hubsOn(
  usage: Usage,
  catalog: Catalog = CATALOG,
): { on: Set<HubId>; reasons: string[] } {
  const on = new Set<HubId>();
  const reasons: string[] = [];
  const label = (id: HubId) => catalog.hubs.find((hub) => hub.id === id)?.label ?? id;
  for (const id of new Set(usage.hubs ?? [])) {
    const hub = catalog.hubs.find((entry) => entry.id === id);
    if (!hub) throw new Error(`Unknown hub: ${id}`);
    if (hub.pricing === "quoted") {
      throw new Error(`${hub.label} requires a contract quote before activation`);
    }
    on.add(id);
    reasons.push(`${hub.label} turned on`);
  }
  let shared = false;
  for (const meter of catalog.meters) {
    if (meter.price === null) continue;
    const used = metrics(meter).some(({ metric }) => (usage.counts[metric] ?? 0) > 0);
    const past = metrics(meter).some(
      ({ metric }) => (usage.counts[metric] ?? 0) > (meter.free_allowance ?? 0),
    );
    if (meter.hub === null) {
      // A shared meter needs a hub from its first use when nothing is free, else past the free amount.
      if (meter.free_allowance === null ? used : past) {
        shared = true;
        reasons.push(`${meter.id} needs a hub`);
      }
      continue;
    }
    if (past && !on.has(meter.hub)) {
      on.add(meter.hub);
      reasons.push(`${meter.id} past the free amount: ${label(meter.hub)}`);
    }
  }
  if (usage.hide_mark) {
    shared = true;
    reasons.push("hides the Zitadel mark");
  }
  if (usage.support_priority) {
    shared = true;
    reasons.push("priority support");
  }
  if ((usage.extra_capacity ?? 0) > 0) {
    shared = true;
    reasons.push("extra capacity");
  }
  if (shared && on.size === 0) on.add(catalog.default_hub);
  return { on, reasons };
}

/**
 * The month's estimate: free while no hub is on, otherwise the hubs' base
 * fees, usage past their included amounts, and capacity and support on top.
 * This estimate never starts a subscription.
 */
export function bill(usage: Usage, catalog: Catalog = CATALOG): Bill {
  const { on, reasons } = hubsOn(usage, catalog);
  const lines = meterLines(usage, catalog, on);
  const usageAmount = lines.reduce((sum, line) => sum + line.amount, 0);
  if (on.size === 0) {
    return {
      plan: "free",
      reasons: [],
      hubs: [],
      lines,
      usage_amount: 0,
      minimum_amount: 0,
      on_top_amount: 0,
      total_amount: 0,
    };
  }
  const hubs: HubLine[] = catalog.hubs
    .filter((hub) => on.has(hub.id))
    .map((hub) => ({ hub: hub.id, label: hub.label, amount: minor(hub.base.amount ?? 0) }));
  const price = (id: string) => minor(catalog.licensed.find((line) => line.id === id)?.amount ?? 0);
  const onTop =
    (usage.support_priority ? price("support_priority") : 0) +
    (usage.extra_capacity ?? 0) * price("extra_capacity");
  const minimum = hubs.reduce((sum, hub) => sum + hub.amount, 0);
  return {
    plan: "pro",
    reasons,
    hubs,
    lines,
    usage_amount: usageAmount,
    minimum_amount: minimum,
    on_top_amount: onTop,
    total_amount: minimum + usageAmount + onTop,
  };
}

/** Price the selected subscription; a free account only shows the estimate of the hubs it would need. */
export function estimateForPlan(month: Bill, plan: Plan): BillingEstimate {
  return {
    plan: plan.id === "free" ? month.plan : plan.id,
    total_amount:
      plan.id === "free"
        ? month.total_amount
        : Math.max(plan.minimum_amount, month.minimum_amount) +
          Math.max(0, month.usage_amount - plan.credit_amount) +
          month.on_top_amount,
    currency: plan.currency,
  };
}
