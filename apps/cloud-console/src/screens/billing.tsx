import { CreditCard } from "lucide-react";
import { useState } from "react";

import type {
  BillingOverview,
  BillingSessionResponse,
  TeamBilling,
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

import { cloudGet, cloudSend } from "../cloud-api";
import { screen } from "./screen";

/**
 * Settings → Billing: each team the person administers, its plan, this
 * period's usage, its invoices and how it pays (root ADR 083 §6). Payment
 * details never pass through the console: changing them, or the plan, opens
 * Stripe's own pages.
 */
export const billingScreen = screen({
  path: "/settings/billing",
  nav: { label: "Billing", view: "settings", order: 2, icon: CreditCard },
  load: () => cloudGet<BillingOverview>("/billing"),
  Screen: BillingScreen,
});

function BillingScreen({ data }: AddonScreenProps<BillingOverview>) {
  return (
    <Page>
      <SettingsColumn>
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Billing</h1>
        </div>
        {data.teams.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            You administer no team, so there is nothing to bill you for.
          </p>
        ) : (
          data.teams.map((team) => <TeamBillingSections key={team.team_id} team={team} />)
        )}
      </SettingsColumn>
    </Page>
  );
}

function TeamBillingSections({ team }: { team: TeamBilling }) {
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
        <SettingsCard>
          <DetailRow label="Plan" align="center">
            <span className="flex items-center gap-2 text-sm">
              {team.plan.name}
              <Badge variant="secondary">
                {money(team.plan.base_amount, team.plan.currency)} / month
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
              </span>
            </DetailRow>
          ))}
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

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

/** Stripe's period, in UTC as Stripe counts it; its end is exclusive, so the last day shows. */
function period({ start, end }: TeamBilling["period"]): string {
  const format = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return `${format(Date.parse(start))} to ${format(Date.parse(end) - 1)}`;
}
