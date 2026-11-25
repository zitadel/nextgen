import type { BillingRequest, Caller, Team } from "../ports";

/**
 * Stripe's API calls for onboarding (root ADR 084 §3), built from our records
 * alone: what the recorder in `src/mock.ts` records and the live client will
 * send. A team's customer is keyed by its `zitadel_team_id` metadata; a label
 * names our ids and never an email, since a log line shows it.
 */

/** The customers whose `zitadel_team_id` is the team's; search lags a write by up to a minute. */
export function findCustomer(team: Team): BillingRequest {
  return {
    label: `find the customer of ${team.id}`,
    method: "GET",
    path: `/v1/customers/search?query=${encodeURIComponent(`metadata['zitadel_team_id']:'${team.id}'`)}`,
  };
}

/**
 * The team's customer, billed to the person who started it until Checkout
 * asks for a billing address. Its idempotency key is the team's and the
 * person's, so a retry, or a second run of theirs, within Stripe's 24 hours
 * gets the first customer back where search would not show it yet.
 */
export function createCustomer(team: Team, owner: Caller): BillingRequest {
  return {
    label: `create the customer of ${team.id} for ${owner.user_id}`,
    method: "POST",
    path: "/v1/customers",
    headers: { "Idempotency-Key": `customer-${team.id}-${owner.user_id}` },
    body: {
      name: team.name,
      email: owner.email,
      "metadata[zitadel_team_id]": team.id,
      "metadata[zitadel_user_id]": owner.user_id,
    },
  };
}
