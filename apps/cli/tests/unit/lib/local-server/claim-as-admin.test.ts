import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LocalAdmin } from "../../../../src/lib/local-server/admin-credential";
import { claimProjectAsAdmin } from "../../../../src/lib/local-server/claim-as-admin";

const SERVER = "http://local-admin.invalid:8080";
const PROJECT = "proj_local";

const admin: LocalAdmin = {
  email: "admin@zitadel.localhost",
  password: "generated-password",
  user_id: "user_localadmin",
  team_id: "team_localadmin",
};

let signIns = 0;
let initAuth: string | null = null;
let complete: { cookie: string | null; body: unknown } | undefined;

/** Enough of the sign-in path to mint the admin's session cookie. */
const sessionHandlers = [
  http.get(`${SERVER}/console/runtime.json`, () =>
    HttpResponse.json({ console_project_id: "proj_platform", publishable_key: "pk_platform" }),
  ),
  http.post(`${SERVER}/auth_attempts`, () => {
    signIns += 1;
    return HttpResponse.json({ attempt_id: "att_1" }, { status: 201 });
  }),
  http.post(`${SERVER}/auth_attempts/:attempt/challenges`, async ({ request }) => {
    const { method } = (await request.json()) as { method: string };
    return HttpResponse.json({ challenge_id: `ch_${method}` }, { status: 201 });
  }),
  http.post(`${SERVER}/auth_attempts/:attempt/challenges/:challenge/verify`, () =>
    HttpResponse.json({ attempt_id: "att_1" }),
  ),
  http.post(`${SERVER}/auth_attempts/:attempt/handoff`, () =>
    HttpResponse.json({ handoff_token: "handoff_1" }),
  ),
  http.post(`${SERVER}/sessions/exchange`, () =>
    new HttpResponse(null, {
      headers: { "set-cookie": "__nextgen_session=admin_session; Path=/; HttpOnly" },
    }),
  ),
];

const server = setupServer(
  ...sessionHandlers,
  http.post(`${SERVER}/projects/${PROJECT}/claim/init`, ({ request }) => {
    initAuth = request.headers.get("authorization");
    return HttpResponse.json({ challenge_id: "claim_ch_1" }, { status: 201 });
  }),
  http.post(`${SERVER}/projects/${PROJECT}/claim/complete`, async ({ request }) => {
    complete = { cookie: request.headers.get("cookie"), body: await request.json() };
    return HttpResponse.json({ team_id: "team_localadmin", claimed_at: "2027-01-01T00:00:00Z" });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  signIns = 0;
  initAuth = null;
  complete = undefined;
});
afterAll(() => server.close());

const claim = () =>
  claimProjectAsAdmin({ serverUrl: SERVER, projectId: PROJECT, projectSecret: "sk_project", admin });

describe("claiming a project as the local admin", () => {
  it("opens the claim with the project secret and completes it as the admin", async () => {
    await expect(claim()).resolves.toEqual({
      team_id: "team_localadmin",
      claimed_at: "2027-01-01T00:00:00Z",
    });

    expect(initAuth).toBe("Bearer sk_project");
    // The claim is completed by the admin's session, answering the challenge
    // claim/init just opened.
    expect(complete?.cookie).toContain("__nextgen_session=admin_session");
    expect(complete?.body).toEqual({ challenge_id: "claim_ch_1" });
  });

  it("reports the owning team of an already-claimed project without signing in", async () => {
    server.use(
      http.post(`${SERVER}/projects/${PROJECT}/claim/init`, () =>
        HttpResponse.json(
          { code: "proj.already_claimed", details: { team_id: "team_someone_else" } },
          { status: 409 },
        ),
      ),
    );

    // No claimed_at: the 409 names the team but not when the claim happened,
    // and setup records a claim only when it has both.
    await expect(claim()).resolves.toEqual({ team_id: "team_someone_else" });
    expect(signIns).toBe(0);
    expect(complete).toBeUndefined();
  });

  it("fails when claim/init opens no challenge", async () => {
    server.use(
      http.post(`${SERVER}/projects/${PROJECT}/claim/init`, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );

    await expect(claim()).rejects.toThrow("Local admin claim/init failed (500): boom");
    expect(signIns).toBe(0);
  });

  it("fails rather than recording a claim the server did not timestamp", async () => {
    server.use(
      http.post(`${SERVER}/projects/${PROJECT}/claim/complete`, () =>
        HttpResponse.json({ team_id: "team_localadmin" }),
      ),
    );

    await expect(claim()).rejects.toThrow(/claim\/complete failed/);
  });
});
