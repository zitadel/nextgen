import { describe, expect, it } from "vitest";

import { MOCK_PERSON, MOCK_TEAM } from "../mock";
import type { BillingRequest } from "../ports";
import { type StripeAnswer, stripeBilling } from "./billing";

const SEARCH = `/v1/customers/search?query=${encodeURIComponent("metadata['zitadel_team_id']:'team_mock'")}`;

/** Stripe holding `customers` for the team's search; every create succeeds. */
function stripe(customers: { id: string }[] = []) {
  const sent: BillingRequest[] = [];
  const billing = stripeBilling(async (request): Promise<StripeAnswer> => {
    sent.push(request);
    if (request.method === "GET") return { status: 200, body: { data: customers } };
    return { status: 200, body: { id: "cus_created" } };
  });
  return { billing, sent };
}

describe("a team's Stripe customer", () => {
  it("is created, keyed by the team, once the search finds none", async () => {
    const write = await stripe().billing.ensureCustomer(MOCK_TEAM, MOCK_PERSON);
    expect(write.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${SEARCH}`,
      "POST /v1/customers",
    ]);
    expect(write.requests[1]).toMatchObject({
      headers: { "Idempotency-Key": "customer-team_mock-user_mock" },
      body: {
        name: "Ada's team",
        email: "ada@example.com",
        "metadata[zitadel_team_id]": "team_mock",
        "metadata[zitadel_user_id]": "user_mock",
      },
    });
    expect(write.customer_id).toBe("cus_created");
  });

  it("is the one an earlier run created, not a second", async () => {
    const write = await stripe([{ id: "cus_earlier" }]).billing.ensureCustomer(
      MOCK_TEAM,
      MOCK_PERSON,
    );
    expect(write.requests.map(({ method }) => method)).toEqual(["GET"]);
    expect(write.customer_id).toBe("cus_earlier");
  });

  it("tells a provisioned team from a new one by the same search", async () => {
    expect(await stripe([{ id: "cus_earlier" }]).billing.hasCustomer(MOCK_TEAM)).toBe(true);
    expect(await stripe().billing.hasCustomer(MOCK_TEAM)).toBe(false);
  });

  it("labels its calls by our ids, never the email a log line would show", async () => {
    const write = await stripe().billing.ensureCustomer(MOCK_TEAM, MOCK_PERSON);
    for (const { label } of write.requests) expect(label).not.toContain(MOCK_PERSON.email);
  });
});
