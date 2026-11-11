import type { Plan } from "../contract";
import { entitlementsFor } from "../pricing/catalog";
import { currentSystems } from "../systems";

/**
 * What a team may do, after Stripe changed its subscription or an invoice
 * (root ADR 084 §6): the plan the subscription is on now, with the allowances
 * the price catalog gives it, written to Zitadel, which enforces them. It
 * reads Stripe's current state rather than the event's, so events out of
 * order or delivered twice end the same.
 */
export async function syncEntitlements(customerId: string): Promise<void> {
  "use workflow";
  const { team_id, plan } = await readPlan(customerId);
  await applyEntitlements(team_id, plan);
}

async function readPlan(customerId: string): Promise<{ team_id: string; plan: Plan["id"] }> {
  "use step";
  return currentSystems().stripe.planOf(customerId);
}

async function applyEntitlements(teamId: string, plan: Plan["id"]): Promise<void> {
  "use step";
  await currentSystems().zitadel.applyEntitlements(teamId, entitlementsFor(plan));
}
