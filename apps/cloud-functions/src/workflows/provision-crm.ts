import type { SignupAttribution } from "../contract";
import type { Caller, CrmWrite } from "../ports";
import { onboardingSystems } from "../systems";

/**
 * A person's records in the CRM (root ADR 084 §3, §7): their contact, to
 * which HubSpot's own workflow sends the onboarding mail, with where their
 * sign-up came from when the contact is new to us; the lead of their sign-up,
 * on that contact, for sales to qualify; and the newsletter and security
 * mail, which they may leave. Their teams reach HubSpot only once they pay.
 * Each step looks for what an earlier attempt made before it writes, so a
 * retry or a second run changes nothing, and returns the calls it made, which
 * the run shows. Until the live adapter lands, those calls are only recorded
 * (§9). Sign-up never waits for this.
 *
 * The subscriptions come last: a step that runs out of retries fails the run
 * and skips the steps after it, and a subscription HubSpot refuses must not
 * cost the sign-up its lead.
 */
export async function provisionCrm(person: Caller, attribution?: SignupAttribution): Promise<void> {
  "use workflow";
  const { contact_id } = await upsertContact(person, attribution);
  await ensureLead(person, contact_id);
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

async function ensureLead(
  person: Caller,
  contactId: string,
): Promise<CrmWrite & { lead_id: string }> {
  "use step";
  return onboardingSystems().hubspot.ensureLead(person, contactId);
}
