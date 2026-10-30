import type { Crm, CrmRequest } from "../ports";
import {
  type HubspotSettings,
  type Subscription,
  adoptContact,
  createContact,
  createDeal,
  findContactByEmail,
  findContactByUserId,
  findDeal,
  linkDeal,
  readSubscriptions,
  subscribeTo,
} from "./requests";

/** HubSpot's answer to one call: a success, or a lookup's 404. */
export interface HubspotAnswer {
  status: number;
  body?: unknown;
}

/**
 * Sends one call to HubSpot's API, answering a success or a lookup's 404 and
 * throwing on anything else, so the workflow step around it retries or stops.
 * The recorder in `src/mock.ts` sends nothing; the live client will be
 * `fetch` with the portal's token.
 */
export type Send = (request: CrmRequest) => Promise<HubspotAnswer>;

const SUBSCRIPTIONS: readonly Subscription[] = ["newsletter", "security"];

/**
 * The CRM's onboarding writes, made of HubSpot's calls (root ADR 084 §3, §7).
 * HubSpot has no idempotency key, so each write looks for what an earlier
 * attempt made before it writes: a retried step, a second run or two at once
 * end in the same records. Each answers the calls it made, which its workflow
 * step returns for the run to show.
 */
export function hubspotCrm(
  send: Send,
  settings: HubspotSettings,
): Pick<Crm, "upsertContact" | "subscribe" | "ensureDeal"> {
  /** One write's calls, sent in order and kept for its answer. */
  function write() {
    const requests: CrmRequest[] = [];
    const call = (request: CrmRequest) => {
      requests.push(request);
      return send(request);
    };
    return { requests, call };
  }

  return {
    async upsertContact(person, attribution) {
      const { requests, call } = write();
      const known = await call(findContactByUserId(person));
      if (known.status !== 404) return { contact_id: idOf(known), requests };
      const existing = await call(findContactByEmail(person));
      if (existing.status !== 404) {
        const contactId = idOf(existing);
        await call(adoptContact(contactId, person, attribution));
        return { contact_id: contactId, requests };
      }
      return { contact_id: idOf(await call(createContact(person, attribution))), requests };
    },

    async subscribe(person) {
      const { requests, call } = write();
      const statuses = await call(readSubscriptions(person));
      const chosen = new Map(
        resultsOf(statuses).map((entry) => [entry.subscriptionId, entry.status]),
      );
      for (const subscription of SUBSCRIPTIONS) {
        const status = chosen.get(settings.subscriptions[subscription]) ?? "NOT_SPECIFIED";
        if (status === "NOT_SPECIFIED") await call(subscribeTo(person, subscription, settings));
      }
      return { requests };
    },

    async ensureDeal(team, contactId) {
      const { requests, call } = write();
      const known = await call(findDeal(team));
      if (known.status === 404) {
        return { deal_id: idOf(await call(createDeal(team, contactId, settings))), requests };
      }
      const dealId = idOf(known);
      await call(linkDeal(dealId, contactId));
      return { deal_id: dealId, requests };
    },
  };
}

/** The id of the record HubSpot answered with. */
function idOf(answer: HubspotAnswer): string {
  const id = (answer.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") {
    throw new Error(`HubSpot answered ${answer.status} without a record id.`);
  }
  return id;
}

/** A subscription status read's entries; none when HubSpot knows no such subscriber. */
function resultsOf(answer: HubspotAnswer): { subscriptionId: number; status: string }[] {
  if (answer.status === 404) return [];
  return (
    (answer.body as { results?: { subscriptionId: number; status: string }[] } | undefined)
      ?.results ?? []
  );
}
