import type { Caller, CrmWrite, Team } from "../ports";
import { onboardingSystems } from "../systems";

/**
 * A person's records in the CRM (root ADR 084 §3, §7): their contact, to
 * which HubSpot's own workflow sends the onboarding mail; the newsletter and
 * security mail, which they may leave; and a deal for each of their teams,
 * with them on it. Each step looks for what an earlier attempt made before it
 * writes, so a retry or a second run changes nothing, and returns the calls it
 * made, which the run shows. Until the live adapter lands, those calls are
 * only recorded (§9). Sign-up never waits for this.
 */
export async function provisionCrm(person: Caller, teams: Team[]): Promise<void> {
  "use workflow";
  const { contact_id } = await upsertContact(person);
  await subscribe(person);
  for (const team of teams) await ensureDeal(team, contact_id);
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
