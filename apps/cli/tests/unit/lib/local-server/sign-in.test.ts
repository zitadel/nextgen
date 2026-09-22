import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LocalAdmin } from "../../../../src/lib/local-server/admin-credential";
import { adminSessionCookie, consoleSignInUrl } from "../../../../src/lib/local-server/sign-in";

const SERVER = "http://local-admin.invalid:8080";

const admin: LocalAdmin = {
  email: "admin@zitadel.localhost",
  password: "generated-password",
  user_id: "user_localadmin",
  team_id: "team_localadmin",
};

type Call = { path: string; body: unknown; authorization: string | null; origin: string | null };
let calls: Call[] = [];

async function record(request: Request): Promise<void> {
  const url = new URL(request.url);
  calls.push({
    path: url.pathname,
    body: await request.clone().json().catch(() => undefined),
    authorization: request.headers.get("authorization"),
    origin: request.headers.get("origin"),
  });
}

/**
 * A server that signs the admin in: the platform project's runtime document,
 * then the auth-attempt state machine through to a handoff token. Each factor
 * gets its own challenge id so a proof can be matched to the challenge it
 * answers.
 */
const signInHandlers = [
  http.get(`${SERVER}/console/runtime.json`, () =>
    HttpResponse.json({ console_project_id: "proj_platform", publishable_key: "pk_platform" }),
  ),
  http.post(`${SERVER}/auth_attempts`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ attempt_id: "att_1", state: "in_progress" }, { status: 201 });
  }),
  http.post(`${SERVER}/auth_attempts/:attempt/challenges`, async ({ request }) => {
    await record(request);
    const { method } = (await request.json()) as { method: string };
    return HttpResponse.json({ challenge_id: `ch_${method}`, method }, { status: 201 });
  }),
  http.post(`${SERVER}/auth_attempts/:attempt/challenges/:challenge/verify`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ attempt_id: "att_1", state: "in_progress" });
  }),
  http.post(`${SERVER}/auth_attempts/:attempt/handoff`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ handoff_token: "handoff/one+time", expires_at: "2027-01-01T00:00:00Z" });
  }),
];

const server = setupServer(...signInHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  calls = [];
});
afterAll(() => server.close());

describe("local admin sign-in", () => {
  it("proves the identifier, then the password, and links the handoff token", async () => {
    const url = await consoleSignInUrl(SERVER, admin);

    // The token is a bearer credential in a query string, so it is encoded.
    expect(url).toBe(`${SERVER}/ui/console/login?handoff=${encodeURIComponent("handoff/one+time")}`);

    expect(calls.map((call) => call.path)).toEqual([
      "/auth_attempts",
      "/auth_attempts/att_1/challenges",
      "/auth_attempts/att_1/challenges/ch_identifier/verify",
      "/auth_attempts/att_1/challenges",
      "/auth_attempts/att_1/challenges/ch_password/verify",
      "/auth_attempts/att_1/handoff",
    ]);
    expect(calls[0]?.body).toEqual({ project_id: "proj_platform" });
    expect(calls[1]?.body).toEqual({ method: "identifier" });
    // The proof names the attribute the value belongs to: the CLI wrote the
    // admin's email under `email`, so it states that rather than guessing.
    expect(calls[2]?.body).toEqual({
      login_name: "admin@zitadel.localhost",
      attribute_name: "email",
    });
    expect(calls[3]?.body).toEqual({ method: "password" });
    expect(calls[4]?.body).toEqual({ password: "generated-password" });

    // Every call carries the platform project's publishable key and the
    // server's own origin.
    for (const call of calls) {
      expect(call.authorization).toBe("Bearer pk_platform");
      expect(call.origin).toBe(SERVER);
    }
  });

  it("exchanges the handoff token for the session cookie", async () => {
    let exchanged: unknown;
    server.use(
      http.post(`${SERVER}/sessions/exchange`, async ({ request }) => {
        exchanged = {
          project: new URL(request.url).searchParams.get("project_id"),
          body: await request.json(),
        };
        return new HttpResponse(null, {
          headers: { "set-cookie": "__nextgen_session=sess_cookie_value; Path=/; HttpOnly" },
        });
      }),
    );

    const cookie = await adminSessionCookie(SERVER, admin);

    expect(cookie).toBe("__nextgen_session=sess_cookie_value");
    expect(exchanged).toEqual({
      project: "proj_platform",
      body: { handoff_token: "handoff/one+time" },
    });
  });

  it("fails when the exchange sets no session cookie", async () => {
    server.use(
      http.post(`${SERVER}/sessions/exchange`, () => HttpResponse.json({}, { status: 200 })),
    );

    await expect(adminSessionCookie(SERVER, admin)).rejects.toThrow(/sessions\/exchange failed/);
  });

  it("refuses a server that does not host the platform project, and says how to fix it", async () => {
    server.use(
      http.get(`${SERVER}/console/runtime.json`, () =>
        HttpResponse.json({ console_project_id: "proj_other", publishable_key: "pk_other" }),
      ),
    );

    const error = await consoleSignInUrl(SERVER, admin).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("does not host the platform project") as string,
      nextCommands: ["zitadel stop", "zitadel start"],
    });
    // Nothing is attempted against a server that cannot sign the admin in.
    expect(calls).toEqual([]);
  });

  // The server reports a failed lookup with the same code as a missing user, so
  // the advice names both causes and never suggests the destructive reset as a
  // command an agent would run.
  it("explains a rejected identifier without steering an agent into a reset", async () => {
    server.use(
      http.post(`${SERVER}/auth_attempts/:attempt/challenges/:challenge/verify`, () =>
        HttpResponse.json(
          { code: "att.proof_rejected", message: "The proof was rejected." },
          { status: 409 },
        ),
      ),
    );

    const error = await consoleSignInUrl(SERVER, admin).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_AUTH",
      message: "The local server could not find the local admin",
      nextCommands: ["zitadel logs"],
    });
    expect((error as { hint: string }).hint).toContain("zitadel reset --force");
    expect((error as { nextCommands: string[] }).nextCommands).not.toContain("zitadel reset --force");
  });

  it("reports a rejected password with the server's own message", async () => {
    server.use(
      http.post(`${SERVER}/auth_attempts/:attempt/challenges/ch_password/verify`, () =>
        HttpResponse.json(
          { code: "att.proof_rejected", message: "The proof was rejected." },
          { status: 409 },
        ),
      ),
    );

    // Only the identifier gets the data-directory explanation; a password
    // failure is reported as the server gave it.
    await expect(consoleSignInUrl(SERVER, admin)).rejects.toThrow(
      "Local admin password proof failed (409): The proof was rejected.",
    );
  });

  it("fails when the handoff carries no token", async () => {
    server.use(
      http.post(`${SERVER}/auth_attempts/:attempt/handoff`, () => HttpResponse.json({})),
    );

    await expect(consoleSignInUrl(SERVER, admin)).rejects.toThrow(/handoff failed/);
  });
});
