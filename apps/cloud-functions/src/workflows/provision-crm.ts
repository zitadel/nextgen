import type { SignupAttribution } from "../contract";
import type { Caller, CrmWrite, Team } from "../ports";
import { onboardingSystems } from "../systems";

/**
 * A person's records in the CRM (root ADR 084 §3, §7): their contact, to
 * which HubSpot's own workflow sends the onboarding mail, with where their
 * sign-up came from when the contact is new to us; a deal for each of
 * their teams, with them on it; and the newsletter and security mail, which
 * they may leave. Each step looks for what an earlier attempt made before it
 * writes, so a retry or a second run changes nothing, and returns the calls it
 * made, which the run shows. Until the live adapter lands, those calls are
 * only recorded (§9). Sign-up never waits for this.
 *
 * The subscriptions come last: a step that runs out of retries fails the run
 * and skips the steps after it, and a subscription HubSpot refuses must not
 * cost a team its deal.
 */
export async function provisionCrm(
  person: Caller,
  teams: Team[],
  attribution?: SignupAttribution,
): Promise<void> {
  "use workflow";
  const { contact_id } = await upsertContact(person, attribution);
  for (const team of teams) await ensureDeal(team, contact_id);
  await subscribe(person);
}

async function upsertContact(
  person: Caller,
  attribution?: SignupAttribution,
): Promise<CrmWrite & { contact_id: string }> {
  "use step";
  return onboardingSystems().hubspot.upsertContact(person, attribution);
}

async function subscribe(person: Caller): Promise<CrmWrite> {
  "use step";
  return onboardingSystems().hubspot.subscribe(person);
}

async function ensureDeal(team: Team, contactId: string): Promise<CrmWrite & { deal_id: string }> {
  "use step";
  return onboardingSystems().hubspot.ensureDeal(team, contactId);
}
