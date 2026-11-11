import type { UsageOverview } from "@zitadel/cloud-functions/contract";
import type { UsagePriceRequest, UsagePrices } from "@zitadel/console/addon";

import { CloudApiError, cloudGet } from "./cloud-api";

/**
 * Prices a project's usage for the console's Usage screen (Console ADR 0006):
 * its part of what its team's period so far costs at list price, which the
 * functions price for the whole team, so allowances and the plan's credit
 * apply to the team (root ADR 084 §6). Nothing to price when no team the
 * person administers has claimed the project, or while the functions bill no
 * one (`cloud.not_live`).
 */
export async function usagePrices(request: UsagePriceRequest): Promise<UsagePrices | undefined> {
  let overview: UsageOverview;
  try {
    overview = await cloudGet<UsageOverview>("/usage");
  } catch (error) {
    if (error instanceof CloudApiError && error.code === "cloud.not_live") return undefined;
    throw error;
  }
  const team = overview.teams.find((candidate) =>
    candidate.projects.some((project) => project.id === request.project_id),
  );
  if (!team) return undefined;
  return {
    currency: team.plan.currency,
    days: team.days.flatMap((day) =>
      day.entries
        .filter((entry) => entry.project_id === request.project_id && entry.amount !== 0)
        .map((entry) => ({
          date: day.date.slice(0, 10),
          meter: entry.metric,
          amount: entry.amount,
        })),
    ),
    note: `${team.team_name}'s ${team.plan.name} plan at list price. Usage is priced after team allowances; the base fee and any contracted credit are applied separately to the team invoice.`,
  };
}
