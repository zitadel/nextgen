import { describe, expect, it } from "vitest";

import type { SignupAttribution } from "../contract";
import { MOCK_PERSON, MOCK_TEAM } from "../mock";
import type { CrmRequest, CrmWrite } from "../ports";
import { type HubspotAnswer, hubspotCrm } from "./crm";
import type { HubspotSettings } from "./requests";

const SETTINGS: HubspotSettings = {
  dealPipeline: "pipeline_1",
  dealStage: "stage_1",
  subscriptions: { newsletter: 11, security: 12 },
  legalBasisExplanation: "Signed up for Zitadel Cloud.",
};

const CONTACT_BY_ID = "/crm/v3/objects/contacts/user_mock?idProperty=zitadel_user_id";
const CONTACT_BY_EMAIL = "/crm/v3/objects/contacts/ada%40example.com?idProperty=email";
const SUBSCRIPTIONS = "/communication-preferences/v4/statuses/ada%40example.com?channel=EMAIL";
const DEAL = "/crm/v3/objects/deals/team_mock?idProperty=zitadel_team_id";

/** HubSpot holding `records` by the path that reads them; every write succeeds. */
function hubspot(records: Record<string, unknown> = {}) {
  return hubspotCrm(async (request: CrmRequest): Promise<HubspotAnswer> => {
    if (request.method === "GET") {
      const record = records[request.path];
      return record === undefined ? { status: 404 } : { status: 200, body: record };
    }
    if (request.method === "POST" && request.path.startsWith("/crm/")) {
      return { status: 201, body: { id: "created_1" } };
    }
    return { status: 200, body: {} };
  }, SETTINGS);
}

const calls = (write: CrmWrite) => write.requests.map(({ method, path }) => `${method} ${path}`);

describe("the person's contact", () => {
  it("is created, keyed by their Zitadel id, once neither lookup finds one", async () => {
    const write = await hubspot().upsertContact(MOCK_PERSON);
    expect(calls(write)).toEqual([
      `GET ${CONTACT_BY_ID}`,
      `GET ${CONTACT_BY_EMAIL}`,
      "POST /crm/v3/objects/contacts",
    ]);
    expect(write.requests[2]?.body).toEqual({
      properties: { email: "ada@example.com", zitadel_user_id: "user_mock" },
    });
    expect(write.contact_id).toBe("created_1");
  });

  it("is the one HubSpot already has for the email, which takes the Zitadel id, not a second", async () => {
    const write = await hubspot({ [CONTACT_BY_EMAIL]: { id: "contact_legacy" } }).upsertContact(
      MOCK_PERSON,
    );
    expect(calls(write).at(-1)).toBe("PATCH /crm/v3/objects/contacts/contact_legacy");
    expect(write.requests.at(-1)?.body).toEqual({ properties: { zitadel_user_id: "user_mock" } });
    expect(write.contact_id).toBe("contact_legacy");
  });
});

describe("the sign-up's source on the contact", () => {
  const source: SignupAttribution = {
    via: "console",
    utm_source: "newsletter",
    utm_medium: "email",
  };
  const written = {
    signup_via: "console",
    signup_utm_source: "newsletter",
    signup_utm_medium: "email",
  };

  it("goes on a contact it creates", async () => {
    const write = await hubspot().upsertContact(MOCK_PERSON, source);
    expect(write.requests.at(-1)?.body).toEqual({
      properties: { email: "ada@example.com", zitadel_user_id: "user_mock", ...written },
    });
  });

  it("goes on the contact it takes over, which joined through a form before", async () => {
    const write = await hubspot({ [CONTACT_BY_EMAIL]: { id: "contact_legacy" } }).upsertContact(
      MOCK_PERSON,
      source,
    );
    expect(write.requests.at(-1)?.body).toEqual({
      properties: { zitadel_user_id: "user_mock", ...written },
    });
  });

  it("is the first touch: a contact already keyed by the person's id keeps what it has", async () => {
    const write = await hubspot({ [CONTACT_BY_ID]: { id: "contact_1" } }).upsertContact(
      MOCK_PERSON,
      { via: "cli", utm_source: "later" },
    );
    expect(calls(write)).toEqual([`GET ${CONTACT_BY_ID}`]);
  });

  it("names no campaign parameter in a label, which a log line shows", async () => {
    const write = await hubspot().upsertContact(MOCK_PERSON, source);
    for (const { label } of write.requests) expect(label).not.toContain("newsletter");
  });
});

describe("the person's subscriptions", () => {
  it("are the newsletter and the security mail, as an existing client's", async () => {
    const write = await hubspot().subscribe(MOCK_PERSON);
    expect(write.requests.slice(1).map((request) => request.body)).toEqual(
      [11, 12].map((subscriptionId) => ({
        channel: "EMAIL",
        statusState: "SUBSCRIBED",
        subscriptionId,
        legalBasis: "LEGITIMATE_INTEREST_CLIENT",
        legalBasisExplanation: "Signed up for Zitadel Cloud.",
      })),
    );
  });

  it("leave alone what the person chose already, an unsubscribe above all", async () => {
    const write = await hubspot({
      [SUBSCRIPTIONS]: {
        results: [
          { subscriptionId: 11, status: "UNSUBSCRIBED" },
          { subscriptionId: 12, status: "NOT_SPECIFIED" },
        ],
      },
    }).subscribe(MOCK_PERSON);
    expect(write.requests.map((request) => request.label)).toEqual([
      "read the subscriptions of user_mock",
      "subscribe user_mock to security",
    ]);
  });
});

describe("the team's deal", () => {
  it("is created in the pipeline's first stage, keyed by the team's id, with the contact on it", async () => {
    const write = await hubspot().ensureDeal(MOCK_TEAM, "contact_1");
    expect(calls(write)).toEqual([`GET ${DEAL}`, "POST /crm/v3/objects/deals"]);
    expect(write.requests[1]?.body).toEqual({
      properties: {
        dealname: "Ada's team on Zitadel Cloud",
        pipeline: "pipeline_1",
        dealstage: "stage_1",
        zitadel_team_id: "team_mock",
      },
      associations: [
        {
          to: { id: "contact_1" },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        },
      ],
    });
    expect(write.deal_id).toBe("created_1");
  });
});

describe("a second run", () => {
  it("writes nothing new: every record is found, and the deal's link is put again as it is", async () => {
    const crm = hubspot({
      [CONTACT_BY_ID]: { id: "contact_1" },
      [SUBSCRIPTIONS]: {
        results: [
          { subscriptionId: 11, status: "SUBSCRIBED" },
          { subscriptionId: 12, status: "UNSUBSCRIBED" },
        ],
      },
      [DEAL]: { id: "deal_1" },
    });
    const writes = [
      await crm.upsertContact(MOCK_PERSON),
      await crm.subscribe(MOCK_PERSON),
      await crm.ensureDeal(MOCK_TEAM, "contact_1"),
    ];
    expect(writes.flatMap(calls).filter((call) => !call.startsWith("GET "))).toEqual([
      "PUT /crm/v4/objects/deals/deal_1/associations/default/contacts/contact_1",
    ]);
  });
});

it("names a person by their id in every label, which a log line shows, never by their email", async () => {
  const crm = hubspot({ [CONTACT_BY_EMAIL]: { id: "contact_legacy" } });
  const writes = [
    await crm.upsertContact(MOCK_PERSON),
    await crm.subscribe(MOCK_PERSON),
    await crm.ensureDeal(MOCK_TEAM, "contact_legacy"),
  ];
  for (const { label } of writes.flatMap((write) => write.requests)) {
    expect(label).not.toContain(MOCK_PERSON.email);
  }
});
