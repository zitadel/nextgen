import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { connectZitadel } from "../../src/index";
import type { InstanceHandle } from "../../src/types";

const BASE = "http://zitadel-testing.invalid";

const handle: InstanceHandle = {
  baseUrl: BASE,
  projectId: "proj_1",
  projectSecret: "secret_1",
  schemaId: "sch_1",
  appOrigin: "http://app.invalid:3002",
};

interface Proof {
  challengeId: string;
  body: Record<string, unknown>;
}

interface Captured {
  attemptBody?: Record<string, unknown>;
  challenges: Array<Record<string, unknown>>;
  proofs: Proof[];
  handoffAttemptId?: string;
  exchangeBody?: Record<string, unknown>;
  exchangeProject?: string;
  exchangeOrigin?: string | null;
}

const captured: Captured = { challenges: [], proofs: [] };

const userHandlers = [
  http.post(`${BASE}/users`, () => HttpResponse.json({ id: "user_1" }, { status: 201 })),
  http.put(`${BASE}/users/:userId/password`, () => new HttpResponse(null, { status: 204 })),
];

// One challenge id per method, so a proof can be attributed to the factor it
// answers without depending on call order.
const challengeIds: Record<string, string> = { identifier: "ch_id", password: "ch_pw" };

const server = setupServer(
  ...userHandlers,
  http.post(`${BASE}/auth_attempts`, async ({ request }) => {
    captured.attemptBody = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      { attempt_id: "att_1", project_id: "proj_1", state: "in_progress", created_at: "2027-01-01T00:00:00Z" },
      { status: 201 },
    );
  }),
  http.post(`${BASE}/auth_attempts/:attemptId/challenges`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    captured.challenges.push(body);
    return HttpResponse.json(
      {
        challenge_id: challengeIds[String(body.method)] ?? "ch_other",
        method: body.method,
        state: "pending",
        created_at: "2027-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),
  http.post(
    `${BASE}/auth_attempts/:attemptId/challenges/:challengeId/verify`,
    async ({ request, params }) => {
      captured.proofs.push({
        challengeId: String(params.challengeId),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({
        attempt_id: "att_1",
        project_id: "proj_1",
        state: "in_progress",
        created_at: "2027-01-01T00:00:00Z",
      });
    },
  ),
  http.post(`${BASE}/auth_attempts/:attemptId/handoff`, ({ params }) => {
    captured.handoffAttemptId = String(params.attemptId);
    return HttpResponse.json({ handoff_token: "handoff_1", expires_at: "2027-01-01T00:01:00Z" });
  }),
  http.post(`${BASE}/sessions/exchange`, async ({ request }) => {
    captured.exchangeBody = (await request.json()) as Record<string, unknown>;
    captured.exchangeProject = new URL(request.url).searchParams.get("project_id") ?? "";
    captured.exchangeOrigin = request.headers.get("origin");
    return HttpResponse.json({
      session: { id: "sess_1", user_id: "user_1", expires_at: "2027-01-01T00:00:00Z" },
      session_token: "session-token-1",
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  captured.challenges = [];
  captured.proofs = [];
  delete captured.attemptBody;
  delete captured.handoffAttemptId;
  delete captured.exchangeBody;
  delete captured.exchangeProject;
  delete captured.exchangeOrigin;
});
afterAll(() => server.close());

describe("seedSession", () => {
  it("proves the identifier and password factors and exchanges the handoff", async () => {
    const zitadel = connectZitadel(handle);
    const session = await zitadel.seedSession();

    expect(captured.attemptBody).toEqual({ project_id: "proj_1" });
    expect(captured.challenges).toEqual([{ method: "identifier" }, { method: "password" }]);

    // The identifier proof names the attribute the value belongs to: the kit
    // seeds users by email, and the server resolves nobody without it.
    expect(captured.proofs[0]).toEqual({
      challengeId: "ch_id",
      body: { login_name: session.user.email, attribute_name: "email" },
    });
    // Each proof answers the challenge just issued for that factor.
    expect(captured.proofs[1]).toEqual({
      challengeId: "ch_pw",
      body: { password: session.user.password },
    });

    expect(captured.handoffAttemptId).toBe("att_1");
    expect(captured.exchangeBody).toEqual({ handoff_token: "handoff_1" });
    expect(captured.exchangeProject).toBe("proj_1");
    // The exchange carries the handle's registered app origin by default.
    expect(captured.exchangeOrigin).toBe("http://app.invalid:3002");

    expect(session.sessionToken).toBe("session-token-1");
    expect(session.expiresAt).toBe("2027-01-01T00:00:00Z");
    expect(session.cookie).toEqual({
      name: "__nextgen_session",
      value: "session-token-1",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
  });

  it("mints for an existing user without seeding", async () => {
    const zitadel = connectZitadel(handle);
    const user = { id: "user_9", email: "kept@acme.com", password: "Fixed-pw-1" };
    server.use(
      http.post(`${BASE}/users`, () => {
        throw new Error("must not seed when a user is provided");
      }),
    );

    const session = await zitadel.seedSession({ user, origin: "http://other.invalid" });

    expect(session.user).toBe(user);
    expect(captured.proofs[0]?.body).toMatchObject({ login_name: "kept@acme.com" });
    expect(captured.exchangeOrigin).toBe("http://other.invalid");
  });

  it("says which factor was rejected when a proof fails", async () => {
    server.use(
      http.post(`${BASE}/auth_attempts/:attemptId/challenges/:challengeId/verify`, () =>
        HttpResponse.json({ code: "att.proof_rejected", message: "The proof was rejected." }, { status: 409 }),
      ),
    );
    const zitadel = connectZitadel(handle);

    await expect(zitadel.seedSession()).rejects.toThrow(/identifier proof was rejected.*identified by email/s);
  });

  // A project requiring more than a password must fail at handoff rather than
  // hand back a session that skipped a factor.
  it("surfaces a handoff the server refuses to complete", async () => {
    server.use(
      http.post(`${BASE}/auth_attempts/:attemptId/handoff`, () =>
        HttpResponse.json(
          { code: "att.not_completed", message: "The attempt is not completed." },
          { status: 409 },
        ),
      ),
    );
    const zitadel = connectZitadel(handle);

    await expect(zitadel.seedSession()).rejects.toThrow();
  });
});
