import type { Caller, CrmWrite, Team } from "../ports";
import { onboardingSystems } from "../systems";

export interface Provisioning {
  person: Caller;
  teams: Team[];
}

/**
 * A new person's records in HubSpot and Stripe (root ADR 084 §3, §7): their
 * contact, to which HubSpot's own workflow sends the onboarding mail; the
 * newsletter and security mail, which they may leave; and for each team a
 * deal with them on it, and a Stripe customer with no subscription. Each step
 * finds what an earlier attempt made, so a retried step or a second run
 * changes nothing, and returns the calls it made, which the run shows. Until
 * the live adapters land, those calls are only recorded (§9). Sign-up never
 * waits for this.
 */
export async function provisionAccount({ person, teams }: Provisioning): Promise<void> {
  "use workflow";
  const { contact_id } = await upsertContact(person);
  await subscribe(person);
  for (const team of teams) {
    await ensureDeal(team, contact_id);
    await ensureCustomer(team, person);
  }
}

async function upsertContact(person: Caller): Promise<CrmWrite & { contact_id: string }> {
  "use step";
  return onboardingSystems().hubspot.upsertContact(person);
}

async function subscribe(person: Caller): Promise<CrmWrite> {
  "use step";
  return onboardingSystems().hubspot.subscribe(person);
}

async function ensureDeal(team: Team, contactId: string): Promise<CrmWrite & { deal_id: string }> {
  "use step";
  return onboardingSystems().hubspot.ensureDeal(team, contactId);
}

async function ensureCustomer(team: Team, person: Caller): Promise<void> {
  "use step";
  await onboardingSystems().stripe.ensureCustomer(team, person);
}
