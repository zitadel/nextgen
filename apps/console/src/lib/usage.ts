import type { GetUsage200 } from "@zitadel/api/generated/model";

import type { UsagePrices } from "@/addon/contract";
import { api } from "@/api/zitadel";
import { errorCode } from "@/lib/api-error";

/**
 * What the server's meters are called on screen (ADR 085). A meter the
 * console does not know yet shows under its own name.
 */
const METER_LABELS: Readonly<Record<string, string>> = {
  monthly_active_users: "Monthly active users",
};

export function meterLabel(meter: string): string {
  return METER_LABELS[meter] ?? meter;
}

/** The UTC month a usage page covers, as the API reads it. */
export interface UsagePeriod {
  /** RFC 3339, the month's first instant. */
  from: string;
  /** RFC 3339, the next month's first instant. */
  to: string;
  /** Every UTC day of the month, `2026-10-01` first. */
  days: string[];
}

/** The UTC month `now` falls in: the period the server bills by. */
export function usagePeriod(now: Date): UsagePeriod {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const days: string[] = [];
  for (let day = start; day < end; day += 24 * 60 * 60 * 1000) {
    days.push(new Date(day).toISOString().slice(0, 10));
  }
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), days };
}

/** A project's usage, or that this deployment counts none. */
export type ProjectUsage = { counted: true; usage: GetUsage200 } | { counted: false };

/** Reads the project's usage of the period by day; `usage.disabled` is an answer, not an error. */
export async function readProjectUsage(
  projectId: string,
  period: UsagePeriod,
): Promise<ProjectUsage> {
  try {
    const usage = await api.getUsage({
      project_id: projectId,
      from: period.from,
      to: period.to,
      granularity: "day",
    });
    return { counted: true, usage };
  } catch (cause) {
    if (errorCode(cause) === "usage.disabled") return { counted: false };
    throw cause;
  }
}

/** One meter's period so far: what it counted and, when priced, what it cost. */
export interface MeterTotal {
  meter: string;
  used: number;
  /** Minor units; absent without prices. */
  amount?: number;
}

/** The meters the usage or the prices name, each with its period's totals. */
export function meterTotals(usage: GetUsage200, prices?: UsagePrices): MeterTotal[] {
  const totals = new Map<string, MeterTotal>();
  const total = (meter: string) => {
    let entry = totals.get(meter);
    if (!entry) {
      entry = prices ? { meter, used: 0, amount: 0 } : { meter, used: 0 };
      totals.set(meter, entry);
    }
    return entry;
  };
  for (const bucket of usage.data) total(bucket.meter).used += bucket.value;
  for (const day of prices?.days ?? []) {
    const entry = total(day.meter);
    entry.amount = (entry.amount ?? 0) + day.amount;
  }
  return [...totals.values()].sort((a, b) =>
    meterLabel(a.meter).localeCompare(meterLabel(b.meter)),
  );
}

/** What the chart draws: counts, or what they cost. */
export type UsageMeasure = "usage" | "cost";

/** One column of the chart: a day, and each meter's value on it. A day still to come has none. */
export type UsageChartRow = { date: string } & Record<string, number | string | null>;

/**
 * One row per day of the period, each meter's count or cost on it, summed
 * up to that day when `cumulative`. Days after `today` (`2026-10-31`) carry
 * no value, so the month keeps its width while only the past is drawn.
 */
export function usageChartRows(
  period: UsagePeriod,
  meters: readonly string[],
  usage: GetUsage200,
  options: { measure: UsageMeasure; cumulative: boolean; today: string; prices?: UsagePrices },
): UsageChartRow[] {
  const byDay = new Map<string, Map<string, number>>();
  const add = (date: string, meter: string, value: number) => {
    const day = byDay.get(date) ?? new Map<string, number>();
    day.set(meter, (day.get(meter) ?? 0) + value);
    byDay.set(date, day);
  };
  if (options.measure === "cost") {
    for (const day of options.prices?.days ?? []) add(day.date, day.meter, day.amount);
  } else {
    for (const bucket of usage.data) add(bucket.start.slice(0, 10), bucket.meter, bucket.value);
  }

  const running = new Map<string, number>();
  return period.days.map((date) => {
    const row: UsageChartRow = { date };
    for (const meter of meters) {
      if (date > options.today) {
        row[meter] = null;
        continue;
      }
      const value = byDay.get(date)?.get(meter) ?? 0;
      const shown = options.cumulative ? (running.get(meter) ?? 0) + value : value;
      running.set(meter, shown);
      row[meter] = shown;
    }
    return row;
  });
}

/** Minor units as the currency writes them: `12345` USD → `$123.45`. */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

/** `2026-10-01T00:00:00Z` → `October 2026`, in UTC, the month the server counts by. */
export function formatPeriod(from: string): string {
  return new Date(from).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-10-05` → `Oct 5`, the UTC day a column stands for. */
export function formatUsageDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
