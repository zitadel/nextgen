import { describe, expect, it, vi } from "vitest";

import { MOCK_TEAM, mockSystems } from "./mock";
import { type Runtime, routes } from "./routes";

const ORIGIN = "https://cloud.example";

function call(method: string, path: string, init: { body?: unknown; headers?: HeadersInit } = {}) {
  const route = routes[`${method} ${path}`];
  if (!route) throw new Error(`no route ${method} ${path}`);
  const runtime: Runtime = { systems: mockSystems(), provisionOnce: vi.fn(async () => true) };
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie: "__nextgen_session=s",
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

  it("starts provisioning with the person's teams and what they ticked at sign-up", async () => {
    const { response, runtime } = call("POST", "/cloud/api/account/ensure", { body: {} });
    expect(await (await response).json()).toEqual({ state: "started" });
    expect(runtime.provisionOnce).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user_mock" }),
      [MOCK_TEAM],
      expect.objectContaining({ product_news: false }),
    );
  });

  it("refuses a ticket without a message", async () => {
    const { response } = call("POST", "/cloud/api/support/tickets", { body: { subject: "Help" } });
    expect((await response).status).toBe(400);
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
