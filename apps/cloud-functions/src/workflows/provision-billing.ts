import type { Caller, Team } from "../ports";
import { onboardingSystems } from "../systems";

/**
 * A Stripe customer for each of a person's teams, with no subscription (root
 * ADR 084 §3): Stripe advises creating the customer at sign-up. Separate from
 * the CRM's onboarding, so neither system's failure holds up the other.
 */
export async function provisionBilling(person: Caller, teams: Team[]): Promise<void> {
  "use workflow";
  for (const team of teams) await ensureCustomer(team, person);
}

async function ensureCustomer(team: Team, person: Caller): Promise<void> {
  "use step";
  await onboardingSystems().stripe.ensureCustomer(team, person);
}
