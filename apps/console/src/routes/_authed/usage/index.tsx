import { createFileRoute } from "@tanstack/react-router";
import type { GetUsage200 } from "@zitadel/api/generated/model";
import { ChartColumn } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { addon } from "@/addon";
import type { UsagePrices } from "@/addon/contract";
import { Page } from "@/components/layout";
import { RESOURCE_TABLE_WRAP, ResourceTitle } from "@/components/resource-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import {
  type UsageMeasure,
  type UsagePeriod,
  formatMoney,
  formatPeriod,
  formatUsageDay,
  meterLabel,
  meterTotals,
  readProjectUsage,
  usageChartRows,
  usagePeriod,
} from "@/lib/usage";

/**
 * The selected project's usage this UTC month (ADR 086): what each meter
 * counted per day, drawn as stacked bars with shadcn's chart, and each
 * meter's month so far. Every build shows the counts; a build whose add-on
 * prices usage (the hosted cloud's) adds what they cost, and a deployment
 * that counts no usage says so.
 */
export const Route = createFileRoute("/_authed/usage/")({
  staticData: { scope: "project", nav: { label: "Usage", order: 9, icon: ChartColumn } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const now = new Date();
    const period = usagePeriod(now);
    const [usage, prices] = await Promise.all([
      readProjectUsage(projectId, period),
      // Prices are the add-on's: one that fails costs the cost column, never the counts.
      addon
        .usagePrices?.({ project_id: projectId, from: period.from, to: period.to })
        .catch(() => undefined),
    ]);
    return { period, today: now.toISOString().slice(0, 10), usage, prices };
  },
  component: UsageScreen,
});

function UsageScreen() {
  const { period, today, usage, prices } = Route.useLoaderData();

  return (
    <Page>
      <ResourceTitle>Usage</ResourceTitle>
      {!usage.counted ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Usage isn't counted here</CardTitle>
            <CardDescription>
              This deployment doesn't count usage. Turn on <code>usage.enabled</code> in the
              server's configuration to count it.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <UsageSections period={period} today={today} usage={usage.usage} prices={prices} />
      )}
    </Page>
  );
}

function UsageSections({
  period,
  today,
  usage,
  prices,
}: {
  period: UsagePeriod;
  today: string;
  usage: GetUsage200;
  prices?: UsagePrices;
}) {
  const totals = meterTotals(usage, prices);
  const meters = totals.map((total) => total.meter);
  const sealed = usage.sealed_through;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {formatPeriod(period.from)} so far.{" "}
        {sealed
          ? `Final through ${formatDateTime(sealed)}; counted every few minutes.`
          : "Nothing counted yet."}
      </p>
      <UsageChartCard period={period} today={today} meters={meters} usage={usage} prices={prices} />
      <Card>
        <CardHeader>
          <CardTitle>By meter</CardTitle>
          <CardDescription>Each meter's month so far.</CardDescription>
        </CardHeader>
        <CardContent>
          {totals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing counted yet this month.</p>
          ) : (
            <div className={RESOURCE_TABLE_WRAP}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meter</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    {prices && <TableHead className="text-right">Cost</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.map((total) => (
                    <TableRow key={total.meter}>
                      <TableCell>{meterLabel(total.meter)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {total.used.toLocaleString()}
                      </TableCell>
                      {prices && (
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(total.amount ?? 0, prices.currency)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {prices?.note && <p className="mt-3 text-sm text-muted-foreground">{prices.note}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/** The chart tokens a meter takes, in order; a sixth meter takes the first again. */
const SERIES = ["--zl-chart-1", "--zl-chart-2", "--zl-chart-3", "--zl-chart-4", "--zl-chart-5"];

function UsageChartCard({
  period,
  today,
  meters,
  usage,
  prices,
}: {
  period: UsagePeriod;
  today: string;
  meters: string[];
  usage: GetUsage200;
  prices?: UsagePrices;
}) {
  const [cumulative, setCumulative] = useState(false);
  const [measure, setMeasure] = useState<UsageMeasure>("usage");
  const shown = prices ? measure : "usage";
  const rows = usageChartRows(period, meters, usage, { measure: shown, cumulative, today, prices });
  const config: ChartConfig = Object.fromEntries(
    meters.map((meter, index) => [
      meter,
      { label: meterLabel(meter), color: `var(${SERIES[index % SERIES.length]})` },
    ]),
  );
  const value = (amount: number) =>
    shown === "cost" && prices ? formatMoney(amount, prices.currency) : amount.toLocaleString();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{shown === "cost" ? "Cost by day" : "Usage by day"}</CardTitle>
          <CardDescription>
            {shown === "cost"
              ? "What each day added to the bill, at list price."
              : "What each meter counted per UTC day. A user counts once a month, on their first day."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {prices && (
            <Tabs
              value={measure}
              onValueChange={(next) => setMeasure(next === "cost" ? "cost" : "usage")}
            >
              <TabsList aria-label="Measure">
                <TabsTrigger value="usage">Usage</TabsTrigger>
                <TabsTrigger value="cost">Cost</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Tabs
            value={cumulative ? "cumulative" : "daily"}
            onValueChange={(next) => setCumulative(next === "cumulative")}
          >
            <TabsList aria-label="Accumulate">
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <BarChart data={rows} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={formatUsageDay}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={shown === "cost" ? 64 : 48}
              allowDecimals={false}
              tickFormatter={(tick: number) => value(tick)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    formatUsageDay(String(payload[0]?.payload?.date ?? ""))
                  }
                  formatter={(amount, name) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">{meterLabel(String(name))}</span>
                      <span className="font-mono tabular-nums">{value(Number(amount))}</span>
                    </div>
                  )}
                />
              }
            />
            {meters.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            {meters.map((meter, index) => (
              <Bar
                key={meter}
                dataKey={meter}
                stackId="usage"
                fill={`var(--color-${meter})`}
                radius={index === meters.length - 1 ? [2, 2, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ChartContainer>
        {meters.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Nothing counted yet this month.</p>
        )}
      </CardContent>
    </Card>
  );
}
