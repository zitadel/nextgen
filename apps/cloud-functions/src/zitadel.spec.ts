import { afterEach, describe, expect, it, vi } from "vitest";

import { liveDirectory } from "./zitadel";

const SERVER = "https://cloud.example";
const COOKIE = "__Host-zitadel_session=s";

/** Zitadel answering by path and query: a body as JSON, a number as a bare status. */
function serve(answers: Record<string, unknown>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    const answer = answers[`${url.pathname}${url.search}`];
    if (answer === undefined) return new Response(null, { status: 404 });
    return typeof answer === "number"
      ? new Response(null, { status: answer })
      : Response.json(answer);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the person calling", () => {
  it("is the one Zitadel says the cookie is, asked past a preview's protection", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass");
    const fetch = serve({
      "/api/v1/users/me": {
        id: "user_1",
        attributes: { email: "ada@example.com", name: "Ada" },
        identifier: "ada@example.com",
        display: "Ada",
      },
    });
    expect(await liveDirectory(SERVER).caller(COOKIE)).toEqual({
      user_id: "user_1",
      email: "ada@example.com",
      display: "Ada",
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("cookie")).toBe(COOKIE);
    expect(headers.get("x-vercel-protection-bypass")).toBe("bypass");
  });

  it("is no one when Zitadel answers 401, as for an anonymous session", async () => {
    serve({ "/api/v1/users/me": 401 });
    expect(await liveDirectory(SERVER).caller(COOKIE)).toBeUndefined();
  });

  it("is never taken for no one when Zitadel fails", async () => {
    serve({ "/api/v1/users/me": 500 });
    await expect(liveDirectory(SERVER).caller(COOKIE)).rejects.toThrow(/500/);
  });
});

/** One membership of `GET /users/me/teams`, joined on the given day of 2026. */
function membership(id: string, membership_status: string, day: string) {
  return { id, name: id, membership_status, created_at: `2026-${day}T00:00:00Z` };
}

describe("the person's teams", () => {
  it("are the active memberships of every page, the earliest being the personal team", async () => {
    serve({
      "/api/v1/users/me/teams?limit=100": {
        teams: [membership("team_b", "active", "10-02"), membership("team_p", "pending", "10-03")],
        next_page_token: "next",
      },
      "/api/v1/users/me/teams?limit=100&page_token=next": {
        teams: [membership("team_a", "active", "10-01")],
      },
    });
    expect(await liveDirectory(SERVER).administeredTeams(COOKIE)).toEqual([
      { id: "team_b", name: "team_b", personal: false },
      { id: "team_a", name: "team_a", personal: true },
    ]);
  });

  it("have no personal team while the earliest membership is not active, as the server has none", async () => {
    serve({
      "/api/v1/users/me/teams?limit=100": {
        teams: [
          membership("team_invited", "pending", "09-01"),
          membership("team_a", "active", "10-01"),
        ],
      },
    });
    expect(await liveDirectory(SERVER).administeredTeams(COOKIE)).toEqual([
      { id: "team_a", name: "team_a", personal: false },
    ]);
  });
});
