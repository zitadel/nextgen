import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamUsage, UsageOverview } from "./contract";
import { MOCK_TEAM, mockSystems } from "./mock";
import { entitlementsFor } from "./pricing/catalog";
import { type Runtime, routes } from "./routes";

const ORIGIN = "https://cloud.example";

function call(method: string, path: string, init: { body?: unknown; headers?: HeadersInit } = {}) {
  const route = routes[`${method} ${path}`];
  if (!route) throw new Error(`no route ${method} ${path}`);
  const runtime: Runtime = { systems: mockSystems(), provisionOnce: vi.fn(async () => true) };
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie: "__Host-zitadel_session=s",
      ...(init.body === undefined ? {} : { "content-type": "application/json", origin: ORIGIN }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { response: route(request, runtime), runtime };
}

describe("the add-on's RPC", () => {
  it("answers 401 without a session", async () => {
    const { response } = call("GET", "/cloud/api/billing", { headers: { cookie: "" } });
    expect((await response).status).toBe(401);
  });

  it.each([
    ["__Host-zitadel_session=s", 200],
    ["theme=dark; zitadel_session=s", 200],
    ["__nextgen_session=s", 401],
  ])("knows the session by the cookie the server sets: %s", async (cookie, status) => {
    const { response } = call("GET", "/cloud/api/billing", { headers: { cookie } });
    expect((await response).status).toBe(status);
  });

  it("refuses a write from another origin, which the cookie alone would let through", async () => {
    const { response } = call("PUT", "/cloud/api/account/preferences", {
      body: { product_news: true },
      headers: { origin: "https://elsewhere.example" },
    });
    const answer = await response;
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.origin_refused" } });
  });

  it("opens Stripe only for a team the person is in, whatever the request names", async () => {
    const { response } = call("POST", "/cloud/api/billing/portal", {
      body: { team_id: "team_other" },
    });
    expect((await response).status).toBe(404);
  });

  it("starts provisioning with the person and the teams they are in", async () => {
    const { response, runtime } = call("POST", "/cloud/api/account/ensure", { body: {} });
    expect(await (await response).json()).toEqual({ state: "started" });
    expect(runtime.provisionOnce).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user_mock" }),
      [MOCK_TEAM],
      undefined,
    );
  });

  it("hands provisioning the sign-up's source, as far as it holds up", async () => {
    const { response, runtime } = call("POST", "/cloud/api/account/ensure", {
      body: {
        attribution: {
          via: "console",
          utm_source: " newsletter ",
          utm_medium: "ada@example.com",
          utm_campaign: 7,
        },
      },
    });
    expect((await response).status).toBe(200);
    expect(vi.mocked(runtime.provisionOnce).mock.calls[0]?.[2]).toEqual({
      via: "console",
      utm_source: "newsletter",
    });
  });

  it("still provisions when the source is not one it knows", async () => {
    const { response, runtime } = call("POST", "/cloud/api/account/ensure", {
      body: { attribution: { via: "fax", utm_source: "newsletter" } },
    });
    expect(await (await response).json()).toEqual({ state: "started" });
    expect(vi.mocked(runtime.provisionOnce).mock.calls[0]?.[2]).toBeUndefined();
  });

  it("refuses a ticket without a message", async () => {
    const { response } = call("POST", "/cloud/api/support/tickets", { body: { subject: "Help" } });
    expect((await response).status).toBe(400);
  });

  it.each([
    { subject: 42, body: "Message" },
    { subject: "Help", body: ["Message"] },
    { subject: "Help", body: "Message", project_id: 7 },
  ])("refuses a ticket whose fields are not what the contract says: %j", async (ticket) => {
    const { response } = call("POST", "/cloud/api/support/tickets", { body: ticket });
    const answer = await response;
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.invalid_ticket" } });
  });

  it("refuses a checkout for a plan there is none of, before it reaches Stripe", async () => {
    const { response } = call("POST", "/cloud/api/billing/checkout", {
      body: { team_id: MOCK_TEAM.id, plan_id: "gold" },
    });
    const answer = await response;
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "cloud.invalid_plan" } });
  });
});

describe("the way back from Stripe", () => {
  it("is the page the person left, on the cloud's origin, and never another site", async () => {
    const back = async (referer: string) => {
      const { response } = call("POST", "/cloud/api/billing/portal", {
        body: { team_id: MOCK_TEAM.id },
        headers: { referer },
      });
      return ((await (await response).json()) as { url: string }).url;
    };
    expect(await back(`${ORIGIN}/console/settings/billing?project=p`)).toBe(
      `${ORIGIN}/console/settings/billing?project=p&mock=stripe-portal`,
    );
    expect(await back("https://elsewhere.example/phish")).toBe(
      `${ORIGIN}/console/settings/billing?mock=stripe-portal`,
    );
  });
});

describe("Settings → Usage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function usage(runtime: Runtime): Promise<TeamUsage> {
    const route = routes["GET /cloud/api/usage"];
    if (!route) throw new Error("no usage route");
    const request = new Request(`${ORIGIN}/cloud/api/usage`, {
      headers: { cookie: "__Host-zitadel_session=s" },
    });
    const { teams } = (await (await route(request, runtime)).json()) as UsageOverview;
    const [team] = teams;
    if (!team) throw new Error("no team");
    return team;
  }

  it("prices each day of the period so the days add up to its bill", async () => {
    const team = await usage({ systems: mockSystems(), provisionOnce: vi.fn() });
    const days = team.days.flatMap(({ entries }) => entries);
    expect(team.days).toHaveLength(31);
    expect(days.reduce((sum, entry) => sum + entry.amount, 0)).toBe(30_500);
    expect(team.projects.map((project) => project.name)).toEqual([
      "Customer portal",
      "Partner API",
    ]);
  });

  it("bills nothing on Free, saying what Pro would", async () => {
    const team = await usage({ systems: mockSystems(), provisionOnce: vi.fn() });
    expect(team).toMatchObject({
      credit: { amount: 0, used: 0 },
      on_demand_amount: 0,
      estimate: { plan: "pro", total_amount: 30_500 },
    });
  });

  it("draws Pro's minimum first, as credit, and bills the rest on demand", async () => {
    const systems = mockSystems();
    await systems.zitadel.applyEntitlements(MOCK_TEAM.id, entitlementsFor("pro"));
    const team = await usage({ systems, provisionOnce: vi.fn() });
    expect(team).toMatchObject({
      credit: { amount: 10_000, used: 10_000 },
      on_demand_amount: 20_500,
    });
  });
});
