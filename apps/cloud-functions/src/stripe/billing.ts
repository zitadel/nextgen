import type { Billing, BillingRequest } from "../ports";
import { createCustomer, findCustomer } from "./requests";

/** Stripe's answer to one call. */
export interface StripeAnswer {
  status: number;
  body?: unknown;
}

/**
 * Sends one call to Stripe's API, answering a success and throwing on
 * anything else, so the workflow step around it retries or stops. The
 * recorder in `src/mock.ts` sends nothing; the live client will be `fetch`
 * with the account's secret key.
 */
export type Send = (request: BillingRequest) => Promise<StripeAnswer>;

/**
 * Billing's onboarding writes, made of Stripe's calls (root ADR 084 §3): a
 * customer per team, found before it is created. `ensureCustomer` answers the
 * calls it made, which its workflow step returns for the run to show.
 */
export function stripeBilling(send: Send): Pick<Billing, "hasCustomer" | "ensureCustomer"> {
  return {
    async hasCustomer(team) {
      return customerIn(await send(findCustomer(team))) !== undefined;
    },

    async ensureCustomer(team, owner) {
      const requests: BillingRequest[] = [];
      const call = (request: BillingRequest) => {
        requests.push(request);
        return send(request);
      };
      const known = customerIn(await call(findCustomer(team)));
      if (known) return { customer_id: known, requests };
      return { customer_id: idOf(await call(createCustomer(team, owner))), requests };
    },
  };
}

/** The first customer a search found, if any. */
function customerIn(answer: StripeAnswer): string | undefined {
  const found = (answer.body as { data?: { id?: unknown }[] } | undefined)?.data?.[0]?.id;
  return typeof found === "string" ? found : undefined;
}

/** The id of the object Stripe answered with. */
function idOf(answer: StripeAnswer): string {
  const id = (answer.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") throw new Error(`Stripe answered ${answer.status} without an id.`);
  return id;
}
