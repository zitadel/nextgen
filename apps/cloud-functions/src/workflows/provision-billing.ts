import type { BillingWrite, Caller, Team } from "../ports";
import { onboardingSystems } from "../systems";

/**
 * A Stripe customer for each of a person's teams, with no subscription (root
 * ADR 084 §3): Stripe advises creating the customer at sign-up. Separate from
 * the CRM's onboarding, so neither system's failure holds up the other. Each
 * step returns the calls it made, which the run shows; until the live adapter
 * lands, they are only recorded (§9).
 */
export async function provisionBilling(person: Caller, teams: Team[]): Promise<void> {
  "use workflow";
  for (const team of teams) await ensureCustomer(team, person);
}

async function ensureCustomer(
  team: Team,
  person: Caller,
): Promise<BillingWrite & { customer_id: string }> {
  "use step";
  return onboardingSystems().stripe.ensureCustomer(team, person);
}
