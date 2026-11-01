import type { SignupAttribution } from "../contract";
import type { Caller, CrmRequest } from "../ports";

/**
 * HubSpot's API calls for onboarding (root ADR 084 §3, §7), built from our
 * records alone: what the recorder in `src/mock.ts` records and the live
 * client will send. A contact, and the lead of its sign-up, are each keyed by
 * `zitadel_user_id`, a unique-value property the portal holds on both; a
 * label names our ids and never an email, since a log line shows it.
 */

/** The portal's own ids, and the reason it records for emailing a person. */
export interface HubspotSettings {
  /** The lead pipeline a sign-up's lead goes into, and the stage it starts in. */
  leadPipeline: string;
  leadStage: string;
  /** The subscription types every new person is on until they unsubscribe. */
  subscriptions: { newsletter: number; security: number };
  /** Recorded with each subscription, beside its legal basis. */
  legalBasisExplanation: string;
}

export type Subscription = keyof HubspotSettings["subscriptions"];

/** HubSpot's own association type from a lead to its primary contact, which every lead needs. */
const LEAD_TO_PRIMARY_CONTACT = 578;

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

/** Puts the person's id, and their sign-up's source, on the contact their email already has. */
export function adoptContact(
  contactId: string,
  person: Caller,
  attribution?: SignupAttribution,
): CrmRequest {
  return {
    label: `take over contact ${contactId} for ${person.user_id}`,
    method: "PATCH",
    path: `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
    body: { properties: { zitadel_user_id: person.user_id, ...signupProperties(attribution) } },
  };
}

export function createContact(person: Caller, attribution?: SignupAttribution): CrmRequest {
  return {
    label: `create the contact of ${person.user_id}`,
    method: "POST",
    path: "/crm/v3/objects/contacts",
    body: {
      properties: {
        email: person.email,
        zitadel_user_id: person.user_id,
        ...signupProperties(attribution),
      },
    },
  };
}

/**
 * The sign-up's source in the portal's own properties (root ADR 084 §3, §9),
 * never HubSpot's "Original Traffic Source", which its tracking script sets
 * for contacts that came through zitadel.com's forms.
 */
function signupProperties(attribution?: SignupAttribution): Record<string, string> {
  if (!attribution) return {};
  const { via, utm_source, utm_medium, utm_campaign } = attribution;
  return {
    signup_via: via,
    ...(utm_source ? { signup_utm_source: utm_source } : {}),
    ...(utm_medium ? { signup_utm_medium: utm_medium } : {}),
    ...(utm_campaign ? { signup_utm_campaign: utm_campaign } : {}),
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

/** The lead of the person's sign-up, by their `zitadel_user_id`; a 404 when there is none. */
export function findLead(person: Caller): CrmRequest {
  return {
    label: `find the lead of ${person.user_id}`,
    method: "GET",
    path: `/crm/v3/objects/leads/${encodeURIComponent(person.user_id)}?idProperty=zitadel_user_id`,
  };
}

/**
 * The sign-up as a lead for sales to qualify (root ADR 084 §7), on the
 * person's contact, with the portal's own lead source for the cloud.
 */
export function createLead(
  person: Caller,
  contactId: string,
  settings: HubspotSettings,
): CrmRequest {
  return {
    label: `create the lead of ${person.user_id} on contact ${contactId}`,
    method: "POST",
    path: "/crm/v3/objects/leads",
    body: {
      properties: {
        hs_lead_name: person.display ?? person.email,
        hs_pipeline: settings.leadPipeline,
        hs_pipeline_stage: settings.leadStage,
        lead_source_zitadel: "Zitadel Cloud",
        zitadel_user_id: person.user_id,
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: LEAD_TO_PRIMARY_CONTACT },
          ],
        },
      ],
    },
  };
}
