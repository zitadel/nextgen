import type { Caller, SignupConsent, Team } from "../ports";
import { currentSystems } from "../systems";

export interface Provisioning {
  person: Caller;
  teams: Team[];
  consent: SignupConsent;
}

/**
 * A new person's records in HubSpot and Stripe (root ADR 084 §3): their
 * contact, with what they ticked at sign-up; a company per team, with them
 * on it; and a Stripe customer per team, with no subscription. Each step
 * finds what an earlier attempt made, so a retried step or a second run
 * changes nothing. Sign-up never waits for this.
 */
export async function provisionAccount({ person, teams, consent }: Provisioning): Promise<void> {
  "use workflow";
  await upsertContact(person, consent);
  for (const team of teams) {
    await upsertCompany(team, person);
    await ensureCustomer(team, person);
  }
}

async function upsertContact(person: Caller, consent: SignupConsent): Promise<void> {
  "use step";
  await currentSystems().hubspot.upsertContact(person, consent);
}

async function upsertCompany(team: Team, person: Caller): Promise<void> {
  "use step";
  await currentSystems().hubspot.upsertCompany(team, person);
}

async function ensureCustomer(team: Team, person: Caller): Promise<void> {
  "use step";
  await currentSystems().stripe.ensureCustomer(team, person);
}
