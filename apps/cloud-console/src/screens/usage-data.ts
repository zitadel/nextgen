import type { TeamUsage, UsageLine } from "@zitadel/cloud-functions/contract";

/** What the chart stacks: each meter, or each project. */
export type GroupBy = "product" | "project";

/** One stacked series: a meter or a project, with its period so far in minor units. */
export interface Series {
  key: string;
  label: string;
  total: number;
}

/** One day's column: what each series added that day, or so far, in the order of the series. */
export interface Column {
  date: string;
  amounts: number[];
}

export interface Breakdown {
  series: Series[];
  columns: Column[];
}

const DAY = 86_400_000;

/**
 * Settings → Usage's chart: a column per day of the period with what each
 * series added to the bill, for one project or all. Daily shows each day on
 * its own, cumulative the period up to it. Days still to come stay empty.
 * Only series that cost something are stacked; the table lists the rest.
 */
export function breakdown(
  team: TeamUsage,
  {
    project,
    groupBy,
    cumulative,
  }: { project: string | null; groupBy: GroupBy; cumulative: boolean },
): Breakdown {
  const names = new Map<string, string>(
    groupBy === "product"
      ? team.usage.map((line) => [line.metric, line.label])
      : team.projects.map(({ id, name }) => [id, name]),
  );
  const totals = new Map<string, number>();
  const days = new Map<string, Map<string, number>>();
  for (const { date, entries } of team.days) {
    const sums = new Map<string, number>();
    for (const entry of entries) {
      if (project && entry.project_id !== project) continue;
      const key = groupBy === "product" ? entry.metric : entry.project_id;
      sums.set(key, (sums.get(key) ?? 0) + entry.amount);
      totals.set(key, (totals.get(key) ?? 0) + entry.amount);
    }
    days.set(date, sums);
  }
  const series = [...totals]
    .filter(([, total]) => total > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([key, total]) => ({ key, label: names.get(key) ?? key, total }));
  const last = team.days.at(-1)?.date ?? "";
  const running = series.map(() => 0);
  const columns: Column[] = [];
  for (let at = Date.parse(team.period.start); at < Date.parse(team.period.end); at += DAY) {
    const date = new Date(at).toISOString();
    const sums = days.get(date);
    const amounts = series.map(({ key }, index) => {
      const added = sums?.get(key) ?? 0;
      running[index] = (running[index] ?? 0) + added;
      return date > last ? 0 : cumulative ? (running[index] ?? 0) : added;
    });
    columns.push({ date, amounts });
  }
  return { series, columns };
}

/** The table's rows: each meter's period so far, or one project's part of it. */
export function meterRows(team: TeamUsage, project: string | null): UsageLine[] {
  if (!project) return team.usage;
  const rows = new Map<string, { used: number; amount: number }>();
  for (const { entries } of team.days) {
    for (const entry of entries) {
      if (entry.project_id !== project) continue;
      const row = rows.get(entry.metric) ?? { used: 0, amount: 0 };
      rows.set(entry.metric, { used: row.used + entry.used, amount: row.amount + entry.amount });
    }
  }
  // The allowance is the team's, so a project's row shows none.
  return team.usage.flatMap(({ metric, label }) => {
    const row = rows.get(metric);
    return row ? [{ metric, label, ...row }] : [];
  });
}

/** The chart's axis: a round step in minor units whose five intervals reach `max`. */
export function axis(max: number): { step: number; top: number } {
  const raw = Math.max(max, 500) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= raw) ?? 10) * power;
  return { step, top: step * 5 };
}
