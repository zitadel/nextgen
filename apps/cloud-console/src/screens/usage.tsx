import { ChartColumn } from "lucide-react";
import { useState } from "react";

import type { TeamUsage, UsageOverview } from "@zitadel/cloud-functions/contract";
import type { AddonScreenProps } from "@zitadel/console/addon";
import {
  Badge,
  Card,
  CardContent,
  DETAIL_CARD,
  DETAIL_TITLE,
  DetailRow,
  PAGE_TITLE_ROW,
  PANEL_BODY_CELL,
  PANEL_HEAD_CELL,
  Page,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsCard,
  SettingsColumn,
  SettingsSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@zitadel/console/addon/ui";

import { type Live, cloudGet, whenLive } from "../cloud-api";
import { day, money, period } from "./format";
import { screen } from "./screen";
import { type Breakdown, type GroupBy, axis, breakdown, meterRows } from "./usage-data";

/**
 * Settings → Usage: each team's period so far, as Vercel's usage page draws
 * it. The plan's minimum is credit that usage draws first; a chart stacks
 * what each day added to the bill by meter or project; a table lists every
 * meter. The counts are the server's, priced by the functions with the
 * catalog (root ADR 084 §6). While the functions bill no one
 * (`cloud.not_live`), it says what it will show.
 */
export const usageScreen = screen({
  path: "/settings/usage",
  nav: { label: "Usage", view: "settings", order: 2, icon: ChartColumn },
  load: () => whenLive(cloudGet<UsageOverview>("/usage")),
  Screen: UsageScreen,
});

function UsageScreen({ data }: AddonScreenProps<Live<UsageOverview>>) {
  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Usage</h1>
        </div>
        {!data.live ? (
          <UsagePreview />
        ) : data.data.teams.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            You administer no team, so there is no usage to show you.
          </p>
        ) : (
          data.data.teams.map((team) => <TeamUsageSections key={team.team_id} team={team} />)
        )}
      </SettingsColumn>
    </Page>
  );
}

/** Before metering is live: what this page will hold. */
function UsagePreview() {
  return (
    <SettingsSection
      title="Free during the preview"
      description="Once the cloud meters usage, each team's day-by-day usage and what it costs shows here."
    >
      <SettingsCard>
        <DetailRow label="Plan" align="center">
          <span className="flex items-center gap-2 text-sm">
            Preview
            <Badge variant="secondary">Free</Badge>
          </span>
        </DetailRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function TeamUsageSections({ team }: { team: TeamUsage }) {
  const [project, setProject] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("product");
  const [cumulative, setCumulative] = useState(false);
  const chart = breakdown(team, { project, groupBy, cumulative });
  const rows = meterRows(team, project);
  const { currency } = team.plan;

  return (
    <>
      <SettingsSection
        title={team.team_name}
        description={`${team.plan.name} plan usage for ${period(team.period)}.`}
      >
        <CreditSummary team={team} />
      </SettingsSection>
      <SettingsSection
        title="Consumption breakdown"
        description="What each day added to the bill at list price. Allowances and the plan's credit apply to the whole team."
      >
        <Card className={DETAIL_CARD}>
          <CardContent className="flex flex-col gap-5 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={project ?? "all"}
                onValueChange={(value) => setProject(value === "all" ? null : value)}
              >
                <SelectTrigger aria-label="Project" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {team.projects.map(({ id, name }) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={groupBy}
                onValueChange={(value) => setGroupBy(value === "project" ? "project" : "product")}
              >
                <SelectTrigger aria-label="Group by" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">By product</SelectItem>
                  <SelectItem value="project">By project</SelectItem>
                </SelectContent>
              </Select>
              <Tabs
                value={cumulative ? "cumulative" : "daily"}
                onValueChange={(value) => setCumulative(value === "cumulative")}
                className="ml-auto"
              >
                <TabsList>
                  <TabsTrigger value="daily">Daily</TabsTrigger>
                  <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <UsageChart chart={chart} currency={currency} />
          </CardContent>
        </Card>
      </SettingsSection>
      <SettingsSection
        title="By product"
        description={
          project
            ? "This project's part of each meter so far. Allowances are the team's, so none shows here."
            : "Each meter so far: what it counted, what the plan includes, and what is past it."
        }
      >
        <Card className={DETAIL_CARD}>
          <CardContent className="px-6 py-2">
            {rows.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">Nothing counted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={PANEL_HEAD_CELL}>Product</TableHead>
                    <TableHead className={`${PANEL_HEAD_CELL} text-right`}>Usage</TableHead>
                    <TableHead className={`${PANEL_HEAD_CELL} text-right`}>Charge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.metric}>
                      <TableCell className={PANEL_BODY_CELL}>{row.label}</TableCell>
                      <TableCell className={`${PANEL_BODY_CELL} text-right tabular-nums`}>
                        {row.used.toLocaleString()}
                        {row.included === undefined
                          ? ""
                          : ` of ${row.included.toLocaleString()} included`}
                      </TableCell>
                      <TableCell className={`${PANEL_BODY_CELL} text-right tabular-nums`}>
                        {money(row.amount, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
    </>
  );
}

/**
 * The plan's credit and what is billed past it, as one bar: the credit
 * usage drew, then on-demand charges, against the credit or the total,
 * whichever is larger. Free has no credit, so it says what Pro would bill.
 */
function CreditSummary({ team }: { team: TeamUsage }) {
  const { credit, on_demand_amount: onDemand, estimate, plan } = team;
  if (credit.amount === 0) {
    return (
      <SettingsCard>
        <DetailRow label="This month so far" align="center">
          <span className="text-sm">
            {estimate.plan === "free"
              ? "Within Free's allowances"
              : `${money(estimate.total_amount, estimate.currency)} on Pro, as this usage is past Free's allowances`}
          </span>
        </DetailRow>
      </SettingsCard>
    );
  }
  const scale = Math.max(credit.amount, credit.used + onDemand);
  return (
    <Card className={DETAIL_CARD}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Included credit</p>
            <p className="font-medium tabular-nums">
              {money(credit.used, plan.currency)} / {money(credit.amount, plan.currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">On-demand charges</p>
            <p className="font-medium tabular-nums">{money(onDemand, plan.currency)}</p>
          </div>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-chart-1" style={{ width: `${(credit.used / scale) * 100}%` }} />
          <div className="bg-chart-4" style={{ width: `${(onDemand / scale) * 100}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

/** The chart tokens a series takes, in order; a sixth series takes the first again. */
const SERIES_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

/** Stacked columns, one per day, with an axis in money and a legend of the series' totals. */
function UsageChart({ chart, currency }: { chart: Breakdown; currency: string }) {
  const { series, columns } = chart;
  const highest = Math.max(0, ...columns.map(({ amounts }) => sum(amounts)));
  const { step, top } = axis(highest);
  const ticks = [0, 1, 2, 3, 4, 5].map((index) => index * step);
  const at = (amount: number) => `${100 - (amount / top) * 100}%`;
  const color = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="relative h-56 w-14 shrink-0" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
              style={{ top: at(tick) }}
            >
              {axisMoney(tick, currency)}
            </span>
          ))}
        </div>
        <div className="flex-1">
          <div className="relative h-56">
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute inset-x-0 border-t border-border"
                style={{ top: at(tick) }}
                aria-hidden="true"
              />
            ))}
            <div
              className="absolute inset-0 flex items-end gap-[3px]"
              role="img"
              aria-label={`What each day added to the bill, ${money(sum(series.map((one) => one.total)), currency)} in all.`}
            >
              {columns.map(({ date, amounts }) => (
                <div
                  key={date}
                  className="flex h-full flex-1 flex-col-reverse"
                  title={`${day(date)}: ${money(sum(amounts), currency)}`}
                >
                  {amounts.map((amount, index) =>
                    amount > 0 ? (
                      <div
                        key={series[index]?.key}
                        className={`${color(index)} last:rounded-t-[2px]`}
                        style={{ height: `${(amount / top) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-[3px] text-xs text-muted-foreground" aria-hidden="true">
            {columns.map(({ date }, index) => (
              <span key={date} className="flex-1 overflow-visible text-center whitespace-nowrap">
                {index % 7 === 2 ? day(date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      {series.length === 0 ? (
        <figcaption className="text-sm text-muted-foreground">
          Nothing past an allowance yet, so nothing has cost anything this period.
        </figcaption>
      ) : (
        <figcaption className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {series.map((one, index) => (
            <span key={one.key} className="flex items-center gap-2">
              <span className={`size-2.5 rounded-[2px] ${color(index)}`} />
              {one.label}
              <span className="text-muted-foreground tabular-nums">
                {money(one.total, currency)}
              </span>
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

function sum(amounts: number[]): number {
  return amounts.reduce((all, amount) => all + amount, 0);
}

/** An axis label: whole currency units when the tick is one. */
function axisMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}
