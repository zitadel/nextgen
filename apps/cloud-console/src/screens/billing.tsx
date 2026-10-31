import { CreditCard } from "lucide-react";
import { useState } from "react";

import type {
  BillingOverview,
  BillingSessionResponse,
  TeamBilling,
  TeamUsage,
  UsageOverview,
} from "@zitadel/cloud-functions/contract";
import type { AddonScreenProps } from "@zitadel/console/addon";
import {
  Badge,
  Button,
  DETAIL_CARD,
  DETAIL_TITLE,
  DetailRow,
  FormError,
  PAGE_TITLE_ROW,
  PANEL_BODY_CELL,
  PANEL_HEAD_CELL,
  Page,
  SettingsCard,
  SettingsColumn,
  SettingsSection,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zitadel/console/addon/ui";

import { type Live, cloudGet, cloudSend, whenLive } from "../cloud-api";
import { money, period } from "./format";
import { screen } from "./screen";

/**
 * Settings → Billing: each team the person administers, its plan, this
 * period's usage and what it comes to so far, its invoices and how it pays
 * (root ADR 084 §6). Payment details never pass through the console:
 * changing them, or the plan, opens Stripe's own pages. The plan's credit
 * and what is billed past it come from the team's usage, which the console's
 * own Usage screen shows per project. While the functions bill no one
 * (`cloud.not_live`), it says the cloud is free during the preview.
 */
export const billingScreen = screen({
  path: "/settings/billing",
  nav: { label: "Billing", view: "settings", order: 2, icon: CreditCard },
  load: () =>
    whenLive(
      Promise.all([
        cloudGet<BillingOverview>("/billing"),
        // The credit bar only: a usage read that fails costs it, not the page.
        cloudGet<UsageOverview>("/usage").catch(() => undefined),
      ]).then(([billing, usage]): BillingData => ({ billing, usage })),
    ),
  Screen: BillingScreen,
});

interface BillingData {
  billing: BillingOverview;
  usage?: UsageOverview;
}

function BillingScreen({ data }: AddonScreenProps<Live<BillingData>>) {
  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Billing</h1>
        </div>
        {!data.live ? (
          <BillingPreview />
        ) : data.data.billing.teams.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            You administer no team, so there is nothing to bill you for.
          </p>
        ) : (
          data.data.billing.teams.map((team) => (
            <TeamBillingSections
              key={team.team_id}
              team={team}
              usage={data.data.usage?.teams.find((candidate) => candidate.team_id === team.team_id)}
            />
          ))
        )}
      </SettingsColumn>
    </Page>
  );
}

/** Before Stripe is live: what the cloud costs now, and when that changes. */
function BillingPreview() {
  return (
    <SettingsSection
      title="Free during the preview"
      description="Zitadel Cloud costs nothing while it is in preview. Nothing is charged until your team picks a plan."
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

function TeamBillingSections({ team, usage }: { team: TeamBilling; usage?: TeamUsage }) {
  const [error, setError] = useState<string>();
  const openStripe = async (path: "/billing/portal" | "/billing/checkout") => {
    setError(undefined);
    try {
      const { url } = await cloudSend<BillingSessionResponse>("POST", path, {
        team_id: team.team_id,
        ...(path === "/billing/checkout" ? { plan_id: "pro" } : {}),
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stripe could not be reached.");
    }
  };

  return (
    <>
      <SettingsSection
        title={team.team_name}
        description={`The plan and usage for ${period(team.period)}.`}
      >
        {usage && usage.credit.amount > 0 && <CreditSummary usage={usage} />}
        <SettingsCard>
          <DetailRow label="Plan" align="center">
            <span className="flex items-center gap-2 text-sm">
              {team.plan.name}
              <Badge variant="secondary">
                {money(team.plan.minimum_amount, team.plan.currency)} / month
              </Badge>
            </span>
          </DetailRow>
          {team.usage.map((line) => (
            <DetailRow key={line.metric} label={line.label} align="center" divider>
              <span className="text-sm">
                {line.used.toLocaleString()}
                {line.included === undefined
                  ? ""
                  : ` of ${line.included.toLocaleString()} included`}
                {line.amount > 0 ? `, ${money(line.amount, team.plan.currency)}` : ""}
              </span>
            </DetailRow>
          ))}
          <DetailRow label="This month so far" align="center" divider>
            <span className="text-sm">{estimate(team)}</span>
          </DetailRow>
          <DetailRow label="Payment method" align="center" divider>
            <span className="text-sm">
              {team.payment_method
                ? `${team.payment_method.brand} ending in ${team.payment_method.last4}`
                : "None yet"}
            </span>
          </DetailRow>
          <div className="flex flex-col gap-2 py-4">
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void openStripe("/billing/portal")}>
                Manage payment and invoices
              </Button>
              {team.plan.id === "free" && (
                <Button onClick={() => void openStripe("/billing/checkout")}>Upgrade to Pro</Button>
              )}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Invoices" description="What Stripe billed this team.">
        <Card className={DETAIL_CARD}>
          <CardContent className="px-6 py-2">
            {team.invoices.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={PANEL_HEAD_CELL}>Number</TableHead>
                    <TableHead className={PANEL_HEAD_CELL}>Issued</TableHead>
                    <TableHead className={PANEL_HEAD_CELL}>Amount</TableHead>
                    <TableHead className={PANEL_HEAD_CELL}>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className={PANEL_BODY_CELL}>
                        <a className="underline underline-offset-4" href={invoice.url}>
                          {invoice.number}
                        </a>
                      </TableCell>
                      <TableCell className={PANEL_BODY_CELL}>
                        {new Date(invoice.issued_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className={PANEL_BODY_CELL}>
                        {money(invoice.amount, invoice.currency)}
                      </TableCell>
                      <TableCell className={PANEL_BODY_CELL}>{invoice.status}</TableCell>
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
 * The plan's credit and what is billed past it, as one bar: the credit usage
 * drew, then on-demand charges, against the credit or the total, whichever
 * is larger. Free has no credit, so it shows none.
 */
function CreditSummary({ usage }: { usage: TeamUsage }) {
  const { credit, on_demand_amount: onDemand, plan } = usage;
  const scale = Math.max(credit.amount, credit.used + onDemand);
  return (
    <Card className={`${DETAIL_CARD} mb-4`}>
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

/**
 * The period's bill so far at list prices. On Free, once usage is past an
 * allowance, it is what Pro would bill instead.
 */
function estimate({ plan, estimate }: TeamBilling): string {
  const total = money(estimate.total_amount, estimate.currency);
  return plan.id === "free" && estimate.plan !== "free"
    ? `${total} on Pro, as this usage is past Free's allowances`
    : total;
}
