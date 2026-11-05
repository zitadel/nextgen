import { http, HttpResponse } from "msw";
import { afterEach, describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import type { LocalAdmin } from "@/lib/local-server/admin-credential";
import { claimProjectAsAdmin } from "@/lib/local-server/claim-as-admin";

const signal = new AbortController().signal;

const SERVER = "http://local-admin.invalid:8080";
const PROJECT = "proj_local";

const admin: LocalAdmin = {
  email: "admin@zitadel.localhost",
  password: "generated-password",
  user_id: "user_localadmin",
  team_id: "team_localadmin",
};

const signIns: number[] = [];
const initAuths: (string | null)[] = [];
const completes: { cookie: string | null; csrf: string | null; body: unknown }[] = [];

/** Enough of the sign-in path to mint the admin's session cookie. */
const sessionHandlers = [
  http.get(`${SERVER}/console/runtime.json`, () =>
    HttpResponse.json({ console_project_id: "proj_platform", publishable_key: "pk_platform" }),
  ),
  http.post(`${SERVER}/api/v1/auth_attempts`, () => {
    signIns.push(1);
    return HttpResponse.json({ attempt_id: "att_1" }, { status: 201 });
  }),
  http.post(`${SERVER}/api/v1/auth_attempts/:attempt/challenges`, async ({ request }) => {
    const { method } = (await request.json()) as { method: string };
    return HttpResponse.json({ challenge_id: `ch_${method}` }, { status: 201 });
  }),
  http.post(`${SERVER}/api/v1/auth_attempts/:attempt/challenges/:challenge/verify`, () =>
    HttpResponse.json({ attempt_id: "att_1" }),
  ),
  http.post(`${SERVER}/api/v1/auth_attempts/:attempt/handoff`, () =>
    HttpResponse.json({ handoff_token: "handoff_1" }),
  ),
  http.post(
    `${SERVER}/api/v1/sessions/exchange`,
    () =>
      new HttpResponse(null, {
        headers: { "set-cookie": "zitadel_session=admin_session; Path=/; HttpOnly" },
      }),
  ),
];

it.beforeEach(({ server }) => {
  server.use(
    ...sessionHandlers,
    http.post(`${SERVER}/api/v1/projects/${PROJECT}/claim/init`, ({ request }) => {
      initAuths.push(request.headers.get("authorization"));
      return HttpResponse.json({ challenge_id: "claim_ch_1" }, { status: 201 });
    }),
    http.get(`${SERVER}/api/v1/sessions/me/csrf`, ({ request }) =>
      request.headers.get("cookie")?.includes("zitadel_session=admin_session")
        ? HttpResponse.json({ csrf_token: "csrf_admin" })
        : HttpResponse.json({ code: "auth.unauthorized" }, { status: 401 }),
    ),
    http.post(`${SERVER}/api/v1/projects/${PROJECT}/claim/complete`, async ({ request }) => {
      completes.push({
        cookie: request.headers.get("cookie"),
        csrf: request.headers.get("x-zitadel-csrf"),
        body: await request.json(),
      });
      return HttpResponse.json({ team_id: "team_localadmin", claimed_at: "2027-01-01T00:00:00Z" });
    }),
  );
});

afterEach(() => {
  signIns.length = 0;
  initAuths.length = 0;
  completes.length = 0;
});

const claim = () =>
  claimProjectAsAdmin({
    serverUrl: SERVER,
    projectId: PROJECT,
    projectSecret: "sk_project",
    admin,
    signal,
  });

describe("claiming a project as the local admin", () => {
  it("opens the claim with the project secret and completes it as the admin", async () => {
    await expect(claim()).resolves.toEqual({
      team_id: "team_localadmin",
      claimed_at: "2027-01-01T00:00:00Z",
    });

    expect(initAuths[0]).toBe("Bearer sk_project");
    // The claim is completed by the admin's session, answering the challenge
    // claim/init just opened.
    expect(completes[0]?.cookie).toContain("zitadel_session=admin_session");
    // A cookie-authenticated write carries the session's CSRF token (ADR 053 §5).
    expect(completes[0]?.csrf).toBe("csrf_admin");
    expect(completes[0]?.body).toEqual({ challenge_id: "claim_ch_1" });
  });

  it("fails when claim/init opens no challenge", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/projects/${PROJECT}/claim/init`, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );

    await expect(claim()).rejects.toMatchObject({ status: 500, body: { message: "boom" } });
    expect(signIns.length).toBe(0);
  });
});
