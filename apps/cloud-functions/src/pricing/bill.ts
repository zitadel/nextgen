import { CATALOG, type Catalog, type Meter } from "./catalog";

/**
 * One account's month as the meters count it: counts by Stripe event name, a
 * banded meter's as `sms_users_us_ca`, and what the account turned on.
 */
export interface Usage {
  counts: Record<string, number>;
  /** Core users above 1M bill only once the owner opts in. */
  bands_opt_in?: boolean;
  hide_mark?: boolean;
  custom_domains?: number;
  /** Regions outside the EU. */
  regions?: number;
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
  /** Free while nothing needs Pro. Enterprise rates are a contract's, so no bill is one. */
  plan: "free" | "pro";
  /** What needs Pro; empty on Free. */
  reasons: string[];
  lines: MeteredLine[];
  usage_amount: number;
  minimum_amount: number;
  on_top_amount: number;
  /** The larger of the minimum and the usage, plus what is billed on top. */
  total_amount: number;
}

const minor = (dollars: number): number => Math.round(dollars * 100);

/** Every meter the month counted something on, priced past its allowance or its pool. */
export function meterLines(usage: Usage, catalog: Catalog = CATALOG): MeteredLine[] {
  const count = (metric: string) => usage.counts[metric] ?? 0;
  const lines: MeteredLine[] = [];
  for (const meter of catalog.meters) {
    const price = meter.price;
    if (price?.model === "per_band") {
      for (const band of price.bands) {
        const metric = `${meter.id}_${band.id}`;
        const users = count(metric);
        if (users === 0) continue;
        if (band.per_user === null || band.extra_message === null) {
          throw new Error(`${metric} has no price yet`);
        }
        const texts = count(`${meter.pool?.meter}_${band.id}`);
        const extra = Math.max(0, texts - users * (meter.pool?.per_user ?? 0));
        const amount = minor(users * band.per_user + extra * band.extra_message);
        lines.push({ metric, meter, used: users, included: 0, amount });
      }
      continue;
    }
    const used = count(meter.id);
    if (used === 0) continue;
    if (price === null) {
      lines.push({ metric: meter.id, meter, used, amount: 0 });
      continue;
    }
    const included = meter.pool_of
      ? count(meter.pool_of) * (poolOwner(catalog, meter.pool_of)?.pool?.per_user ?? 0)
      : (meter.allowance ?? 0);
    let amount = 0;
    if (price.model === "per_unit") {
      amount = minor(Math.max(0, used - included) * price.unit_amount);
    } else if (!price.opt_in || usage.bands_opt_in) {
      const started = Math.ceil(Math.max(0, used - price.above) / price.size);
      amount = minor(Math.min(started, (price.until - price.above) / price.size) * price.amount);
    }
    lines.push({ metric: meter.id, meter, used, included, amount });
  }
  return lines;
}

/**
 * The month's invoice: Free while nothing needs Pro, else the larger of Pro's
 * minimum and the usage, since the minimum is credit, plus the lines billed on
 * top, which never draw on it.
 */
export function bill(usage: Usage, catalog: Catalog = CATALOG): Bill {
  const lines = meterLines(usage, catalog);
  const usageAmount = lines.reduce((sum, line) => sum + line.amount, 0);
  const reasons = proReasons(usage, lines, usageAmount, catalog);
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
  const domains = Math.max(
    0,
    (usage.custom_domains ?? 0) - catalog.plans.pro.custom_domains_included,
  );
  const onTop =
    domains * price("custom_domain_extra") +
    (usage.regions ?? 0) * price("region") +
    (usage.support_priority ? price("support_priority") : 0);
  const minimum = minor(catalog.plans.pro.minimum.amount);
  return {
    plan: "pro",
    reasons,
    lines,
    usage_amount: usageAmount,
    minimum_amount: minimum,
    on_top_amount: onTop,
    total_amount: Math.max(minimum, usageAmount) + onTop,
  };
}

/** Why a month needs Pro: usage past an allowance, Free's sizing outgrown, or what Free lacks. */
function proReasons(
  usage: Usage,
  lines: MeteredLine[],
  usageAmount: number,
  catalog: Catalog,
): string[] {
  const reasons: string[] = [];
  if (usageAmount > 0) reasons.push("usage past an allowance");
  if ((usage.counts.monthly_active_users ?? 0) > catalog.plans.free.limits.core_mau_sized_for) {
    reasons.push("more users than Free is sized for");
  }
  if (usage.hide_mark) reasons.push("hides the attribution mark");
  if ((usage.custom_domains ?? 0) > 0) reasons.push("hosted login on a custom domain");
  if ((usage.regions ?? 0) > 0) reasons.push("a region outside the EU");
  if (usage.support_priority) reasons.push("priority support");
  for (const line of lines) {
    if (line.meter.plans && !line.meter.plans.includes("free")) {
      reasons.push(`${line.metric} is not on Free`);
    }
  }
  return reasons;
}

function poolOwner(catalog: Catalog, id: string): Meter | undefined {
  return catalog.meters.find((meter) => meter.id === id);
}
