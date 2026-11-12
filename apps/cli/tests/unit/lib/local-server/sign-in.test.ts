import { http, HttpResponse } from "msw";

import { afterEach, describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import type { LocalAdmin } from "@/lib/local-server/admin-credential";
import { EXIT_CODES, toZitadelError, type ZitadelError } from "@/lib/errors";
import { adminSessionCookie, consoleSignInUrl } from "@/lib/local-server/sign-in";

const signal = new AbortController().signal;

const SERVER = "http://local-admin.invalid:8080";

const admin: LocalAdmin = {
  email: "admin@zitadel.localhost",
  password: "generated-password",
  user_id: "user_localadmin",
  team_id: "team_localadmin",
};

type Call = { path: string; body: unknown; authorization: string | null; origin: string | null };
const calls: Call[] = [];

async function record(request: Request): Promise<void> {
  const url = new URL(request.url);
  calls.push({
    path: url.pathname,
    body: await request
      .clone()
      .json()
      .catch(() => undefined),
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
  http.post(`${SERVER}/api/v1/auth_attempts`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ attempt_id: "att_1", state: "in_progress" }, { status: 201 });
  }),
  http.post(`${SERVER}/api/v1/auth_attempts/:attempt/challenges`, async ({ request }) => {
    await record(request);
    const { method } = (await request.json()) as { method: string };
    return HttpResponse.json({ challenge_id: `ch_${method}`, method }, { status: 201 });
  }),
  http.post(
    `${SERVER}/api/v1/auth_attempts/:attempt/challenges/:challenge/verify`,
    async ({ request }) => {
      await record(request);
      return HttpResponse.json({ attempt_id: "att_1", state: "in_progress" });
    },
  ),
  http.post(`${SERVER}/api/v1/auth_attempts/:attempt/handoff`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({
      handoff_token: "handoff/one+time",
      expires_at: "2027-01-01T00:00:00Z",
    });
  }),
];

it.beforeEach(({ server }) => {
  server.use(...signInHandlers);
});

afterEach(() => {
  calls.length = 0;
});

describe("local admin sign-in", () => {
  it("proves the identifier, then the password, and links the handoff token", async () => {
    const url = await consoleSignInUrl(SERVER, admin, signal);

    // The token is a bearer credential in a query string, so it is encoded.
    expect(url).toBe(
      `${SERVER}/ui/console/login?handoff=${encodeURIComponent("handoff/one+time")}`,
    );

    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/auth_attempts",
      "/api/v1/auth_attempts/att_1/challenges",
      "/api/v1/auth_attempts/att_1/challenges/ch_identifier/verify",
      "/api/v1/auth_attempts/att_1/challenges",
      "/api/v1/auth_attempts/att_1/challenges/ch_password/verify",
      "/api/v1/auth_attempts/att_1/handoff",
    ]);
    expect(calls[0]?.body).toEqual({ project_id: "proj_platform" });
    expect(calls[1]?.body).toEqual({ method: "identifier" });
    // Only the value: the server decides which property identifies the admin,
    // from the project's designated identifier, so the client never names one.
    expect(calls[2]?.body).toEqual({ login_name: "admin@zitadel.localhost" });
    expect(calls[3]?.body).toEqual({ method: "password" });
    expect(calls[4]?.body).toEqual({ password: "generated-password" });

    // Every call carries the platform project's publishable key and the
    // server's own origin.
    for (const call of calls) {
      expect(call.authorization).toBe("Bearer pk_platform");
      expect(call.origin).toBe(SERVER);
    }
  });

  it("exchanges the handoff token for the session cookie", async ({ server }) => {
    const exchanges: unknown[] = [];
    server.use(
      http.post(`${SERVER}/api/v1/sessions/exchange`, async ({ request }) => {
        exchanges.push({
          project: new URL(request.url).searchParams.get("project_id"),
          body: await request.json(),
        });
        return new HttpResponse(null, {
          headers: { "set-cookie": "zitadel_session=sess_cookie_value; Path=/; HttpOnly" },
        });
      }),
    );

    const cookie = await adminSessionCookie(SERVER, admin, signal);

    expect(cookie).toBe("zitadel_session=sess_cookie_value");
    expect(exchanges[0]).toEqual({
      project: "proj_platform",
      body: { handoff_token: "handoff/one+time" },
    });
  });

  /**
   * What the exchange failed with, as the CLI would report it.
   *
   * The exchange is the one call made without the generated client, so the
   * transport's failure has to be translated on the way out of the backend or
   * the CLI reports an unreachable server as a bad request, with the wrong exit
   * code and none of the "check your connection" guidance.
   *
   * It reads no body, only the header the session arrives in, so a body that
   * cannot be read is not one of its failures; `lib/backend/transport` covers
   * that for the callers that do read one.
   */
  async function exchangeFailure(): Promise<ZitadelError> {
    return adminSessionCookie(SERVER, admin, signal).then(
      () => {
        throw new Error("the exchange was expected to fail");
      },
      (error: unknown) => {
        return toZitadelError(error);
      },
    );
  }

  it("reports an exchange it cannot connect to as a network failure", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/sessions/exchange`, () => {
        return HttpResponse.error();
      }),
    );

    const failure = await exchangeFailure();

    expect(failure.code).toBe("E_NETWORK");
    expect(failure.exitCode).toBe(EXIT_CODES.E_NETWORK);
    expect(failure.hint).toContain("connection");
  });

  // A server reached over https sets the prefixed name, and takes it back.
  it("keeps the session cookie under the prefixed name an https server sets", async ({
    server,
  }) => {
    server.use(
      http.post(
        `${SERVER}/api/v1/sessions/exchange`,
        () =>
          new HttpResponse(null, {
            headers: {
              "set-cookie": "__Host-zitadel_session=sess_cookie_value; Path=/; HttpOnly; Secure",
            },
          }),
      ),
    );

    const cookie = await adminSessionCookie(SERVER, admin, signal);

    expect(cookie).toBe("__Host-zitadel_session=sess_cookie_value");
  });

  it.for<[string, Record<string, string>]>([
    ["sets no session cookie", {}],
    [
      "sets only a session cookie from before ADR 083",
      { "set-cookie": "__nextgen_session=sess_cookie_value; Path=/; HttpOnly" },
    ],
  ])("fails when the exchange %s", async ([_label, headers], { server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/sessions/exchange`, () =>
        HttpResponse.json({}, { status: 200, headers }),
      ),
    );

    await expect(adminSessionCookie(SERVER, admin, signal)).rejects.toThrow(
      "Local admin session exchange failed (200)",
    );
  });

  it("refuses a server that does not host the platform project, and says how to fix it", async ({
    server,
  }) => {
    server.use(
      http.get(`${SERVER}/console/runtime.json`, () =>
        HttpResponse.json({ console_project_id: "proj_other", publishable_key: "pk_other" }),
      ),
    );

    const error = await consoleSignInUrl(SERVER, admin, signal).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("does not host the platform project") as string,
      nextCommands: [{ id: "stop" }, { id: "start" }],
    });
    // Nothing is attempted against a server that cannot sign the admin in.
    expect(calls).toEqual([]);
  });

  // The server reports a failed lookup with the same code as a missing user, so
  // the advice names both causes and never suggests the destructive reset as a
  // command an agent would run.
  it("explains a rejected identifier without steering an agent into a reset", async ({
    server,
  }) => {
    server.use(
      http.post(`${SERVER}/api/v1/auth_attempts/:attempt/challenges/:challenge/verify`, () =>
        HttpResponse.json(
          { code: "att.proof_rejected", message: "The proof was rejected." },
          { status: 409 },
        ),
      ),
    );

    const error = await consoleSignInUrl(SERVER, admin, signal).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_AUTH",
      message: "The local server could not find the local admin",
      nextCommands: [{ id: "logs" }],
    });
    expect((error as { hint: string }).hint).toContain("zitadel reset --force");
    expect((error as { nextCommands: unknown[] }).nextCommands).not.toContainEqual({
      id: "reset",
      flags: { force: true },
    });
  });

  it("reports a rejected password with the server's own message", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/auth_attempts/:attempt/challenges/ch_password/verify`, () =>
        HttpResponse.json(
          { code: "att.proof_rejected", message: "The proof was rejected." },
          { status: 409 },
        ),
      ),
    );

    // Only the identifier gets the data-directory explanation; a password
    // failure is reported as the server gave it.
    await expect(consoleSignInUrl(SERVER, admin, signal)).rejects.toMatchObject({
      status: 409,
      body: { message: "The proof was rejected." },
    });
  });
});
