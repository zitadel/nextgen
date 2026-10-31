import type { TeamBilling, TeamUsage, UsageDay, UsageEntry, UsageLine } from "../contract";
import type { DayCount, TeamDays, UsageWindow } from "../ports";
import { type MeteredLine, type Usage, bill, meterLines } from "./bill";
import { CATALOG, type Catalog } from "./catalog";

const DAY = 86_400_000;

/**
 * The period up to the end of today, UTC: what Settings → Usage shows, so a
 * day already begun shows what it counted so far.
 */
export function periodSoFar(period: UsageWindow, now: Date): UsageWindow {
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  return {
    start: period.start,
    end: new Date(Math.min(Date.parse(period.end), tomorrow)).toISOString(),
  };
}

/**
 * A team's period so far for Settings → Usage: its days priced by
 * `pricedDays`, its meters as Billing lists them, and how much of the plan's
 * minimum the usage has drawn. The minimum is credit, so usage past it is
 * billed on demand.
 */
export function teamUsage(
  billing: TeamBilling,
  { projects, counts }: TeamDays,
  catalog: Catalog = CATALOG,
): TeamUsage {
  const total: Record<string, number> = {};
  for (const { metric, value } of counts) total[metric] = (total[metric] ?? 0) + value;
  const month = bill({ counts: total }, catalog);
  const { plan } = billing;
  const credit = plan.minimum_amount;
  return {
    team_id: billing.team_id,
    team_name: billing.team_name,
    plan,
    period: billing.period,
    projects,
    days: pricedDays(counts, catalog),
    usage: month.lines.map(usageLine),
    credit: { amount: credit, used: Math.min(credit, month.usage_amount) },
    // Free bills nothing; what Pro would is in the estimate.
    on_demand_amount: plan.id === "free" ? 0 : Math.max(0, month.usage_amount - credit),
    estimate: {
      plan: plan.id === "free" ? month.plan : plan.id,
      total_amount: Math.max(credit, month.total_amount),
      currency: plan.currency,
    },
  };
}

/** A metered line as the console lists it. */
export function usageLine(line: MeteredLine): UsageLine {
  return {
    metric: line.metric,
    label: line.meter.label,
    used: line.used,
    included: line.included,
    amount: line.amount,
  };
}

/**
 * Each day's counts, priced as what the day added to the period's bill: the
 * bill so far after the day less the one before it, meter by meter. A day
 * costs nothing while its meter's allowance lasts and the marginal price
 * after, so the days add up to the period's bill exactly. A project's part of
 * a day is its share of the meter's count that day; what a day moves on a
 * meter that counted nothing that day, such as a pool another meter grew, is
 * shared by the projects' counts.
 */
export function pricedDays(counts: DayCount[], catalog: Catalog = CATALOG): UsageDay[] {
  const days = new Map<string, DayCount[]>();
  for (const count of counts) days.set(count.day, [...(days.get(count.day) ?? []), count]);
  const total: Record<string, number> = {};
  let before = new Map<string, number>();
  return [...days.keys()].sort().map((date) => {
    const day = days.get(date) ?? [];
    for (const { metric, value } of day) total[metric] = (total[metric] ?? 0) + value;
    const after = amounts({ counts: { ...total } }, catalog);
    const entries: UsageEntry[] = [];
    const metrics = new Set([
      ...day.map((count) => count.metric),
      ...after.keys(),
      ...before.keys(),
    ]);
    for (const metric of metrics) {
      const added = (after.get(metric) ?? 0) - (before.get(metric) ?? 0);
      const counted = day.filter((count) => count.metric === metric);
      if (counted.length > 0) {
        const parts = shares(
          added,
          counted.map((count) => count.value),
        );
        counted.forEach(({ project_id, value }, index) => {
          entries.push({ project_id, metric, used: value, amount: parts[index] ?? 0 });
        });
      } else if (added !== 0) {
        const projects = new Map<string, number>();
        for (const count of day) {
          projects.set(count.project_id, (projects.get(count.project_id) ?? 0) + count.value);
        }
        const parts = shares(added, [...projects.values()]);
        [...projects.keys()].forEach((project_id, index) => {
          entries.push({ project_id, metric, used: 0, amount: parts[index] ?? 0 });
        });
      }
    }
    before = after;
    return { date, entries };
  });
}

function amounts(usage: Usage, catalog: Catalog): Map<string, number> {
  return new Map(meterLines(usage, catalog).map((line) => [line.metric, line.amount]));
}

/** `total` split by `weights` in whole minor units that add up to it exactly. */
function shares(total: number, weights: number[]): number[] {
  const sum = weights.reduce((all, weight) => all + weight, 0);
  const exact = weights.map((weight) =>
    sum > 0 ? (total * weight) / sum : total / weights.length,
  );
  const parts = exact.map(Math.trunc);
  let rest = total - parts.reduce((all, part) => all + part, 0);
  const largest = exact
    .map((value, index) => ({ index, fraction: Math.abs(value - Math.trunc(value)) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of largest) {
    if (rest === 0) break;
    const step = Math.sign(rest);
    parts[index] = (parts[index] ?? 0) + step;
    rest -= step;
  }
  return parts;
}
