import type { Caller, CrmRequest, Team } from "../ports";

/**
 * HubSpot's API calls for onboarding (root ADR 084 §3, §7), built from our
 * records alone: what the recorder in `src/mock.ts` records and the live
 * client will send. A contact is keyed by `zitadel_user_id` and a deal by
 * `zitadel_team_id`, unique-value properties the portal holds; a label names
 * our ids and never an email, since a log line shows it.
 */

/** The portal's own ids, and the reason it records for emailing a person. */
export interface HubspotSettings {
  /** The pipeline a team's deal goes into, and the stage it starts in. */
  dealPipeline: string;
  dealStage: string;
  /** The subscription types every new person is on until they unsubscribe. */
  subscriptions: { newsletter: number; security: number };
  /** Recorded with each subscription, beside its legal basis. */
  legalBasisExplanation: string;
}

export type Subscription = keyof HubspotSettings["subscriptions"];

/** HubSpot's own association type from a deal to its contact. */
const DEAL_TO_CONTACT = 3;

/** The contact whose `zitadel_user_id` is the person's; a 404 when there is none. */
export function findContactByUserId(person: Caller): CrmRequest {
  return {
    label: `find the contact of ${person.user_id}`,
    method: "GET",
    path: `/crm/v3/objects/contacts/${encodeURIComponent(person.user_id)}?idProperty=zitadel_user_id`,
  };
}

/** The contact HubSpot already has for the person's email, from a form or the legacy cloud. */
export function findContactByEmail(person: Caller): CrmRequest {
  return {
    label: `find a contact by the email of ${person.user_id}`,
    method: "GET",
    path: `/crm/v3/objects/contacts/${encodeURIComponent(person.email)}?idProperty=email`,
  };
}

/** Puts the person's id on the contact their email already has. */
export function adoptContact(contactId: string, person: Caller): CrmRequest {
  return {
    label: `take over contact ${contactId} for ${person.user_id}`,
    method: "PATCH",
    path: `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
    body: { properties: { zitadel_user_id: person.user_id } },
  };
}

export function createContact(person: Caller): CrmRequest {
  return {
    label: `create the contact of ${person.user_id}`,
    method: "POST",
    path: "/crm/v3/objects/contacts",
    body: { properties: { email: person.email, zitadel_user_id: person.user_id } },
  };
}

/** The person's choice per subscription type: `SUBSCRIBED`, `UNSUBSCRIBED` or `NOT_SPECIFIED`. */
export function readSubscriptions(person: Caller): CrmRequest {
  return {
    label: `read the subscriptions of ${person.user_id}`,
    method: "GET",
    path: `/communication-preferences/v4/statuses/${encodeURIComponent(person.email)}?channel=EMAIL`,
  };
}

/** Subscribes the person as an existing client, which needs no opt-in but lets them leave. */
export function subscribeTo(
  person: Caller,
  subscription: Subscription,
  settings: HubspotSettings,
): CrmRequest {
  return {
    label: `subscribe ${person.user_id} to ${subscription}`,
    method: "POST",
    path: `/communication-preferences/v4/statuses/${encodeURIComponent(person.email)}`,
    body: {
      channel: "EMAIL",
      statusState: "SUBSCRIBED",
      subscriptionId: settings.subscriptions[subscription],
      legalBasis: "LEGITIMATE_INTEREST_CLIENT",
      legalBasisExplanation: settings.legalBasisExplanation,
    },
  };
}

/** The deal whose `zitadel_team_id` is the team's; a 404 when there is none. */
export function findDeal(team: Team): CrmRequest {
  return {
    label: `find the deal of ${team.id}`,
    method: "GET",
    path: `/crm/v3/objects/deals/${encodeURIComponent(team.id)}?idProperty=zitadel_team_id`,
  };
}

export function createDeal(team: Team, contactId: string, settings: HubspotSettings): CrmRequest {
  return {
    label: `create the deal of ${team.id} with contact ${contactId}`,
    method: "POST",
    path: "/crm/v3/objects/deals",
    body: {
      properties: {
        dealname: `${team.name} on Zitadel Cloud`,
        pipeline: settings.dealPipeline,
        dealstage: settings.dealStage,
        zitadel_team_id: team.id,
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT }],
        },
      ],
    },
  };
}

/** Puts the contact on the deal; a link that exists already stays as it is. */
export function linkDeal(dealId: string, contactId: string): CrmRequest {
  return {
    label: `link deal ${dealId} to contact ${contactId}`,
    method: "PUT",
    path: `/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/default/contacts/${encodeURIComponent(contactId)}`,
  };
}
