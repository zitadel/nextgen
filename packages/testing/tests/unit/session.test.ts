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

interface Captured {
  flowStart?: Record<string, unknown>;
  flowStartOrigin?: string | null;
  submits: Array<Record<string, unknown>>;
  submitCookies: Array<string | null>;
  exchangeBody?: Record<string, unknown>;
  exchangeProject?: string;
}

const captured: Captured = { submits: [], submitCookies: [] };

const identifierStep = {
  id: "flow_1",
  session_token: "flow-token-1",
  step: { name: "identifier", fields: [{ name: "email" }] },
};
const passwordStep = {
  id: "flow_1",
  session_token: "flow-token-2",
  step: { name: "password", fields: [{ name: "x-auth-methods#password" }] },
};
const terminalStep = {
  id: "flow_1",
  session_token: "flow-token-3",
  step: { name: "done", complete: "show" },
  handoff_token: "handoff_1",
};

const userHandlers = [
  http.post(`${BASE}/users`, () => HttpResponse.json({ id: "user_1" }, { status: 201 })),
  http.put(`${BASE}/users/:userId/password`, () => new HttpResponse(null, { status: 204 })),
];

const server = setupServer(
  ...userHandlers,
  http.post(`${BASE}/flow`, async ({ request }) => {
    captured.flowStart = (await request.json()) as Record<string, unknown>;
    captured.flowStartOrigin = request.headers.get("origin");
    return HttpResponse.json(identifierStep, {
      status: 201,
      headers: { "set-cookie": "_zflow=state-1; HttpOnly; Path=/" },
    });
  }),
  http.post(`${BASE}/flow/:id/submit`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    captured.submits.push(body);
    captured.submitCookies.push(request.headers.get("cookie"));
    return HttpResponse.json(captured.submits.length === 1 ? passwordStep : terminalStep, {
      headers: { "set-cookie": `_zflow=state-${captured.submits.length + 1}; HttpOnly; Path=/` },
    });
  }),
  http.post(`${BASE}/sessions/exchange`, async ({ request }) => {
    captured.exchangeBody = (await request.json()) as Record<string, unknown>;
    captured.exchangeProject = new URL(request.url).searchParams.get("project_id") ?? "";
    return HttpResponse.json({
      session: { id: "sess_1", user_id: "user_1", expires_at: "2027-01-01T00:00:00Z" },
      session_token: "session-token-1",
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  captured.submits = [];
  captured.submitCookies = [];
  delete captured.flowStart;
  delete captured.flowStartOrigin;
  delete captured.exchangeBody;
  delete captured.exchangeProject;
});
afterAll(() => server.close());

describe("seedSession", () => {
  it("drives the two-step flow like the orchestrator and exchanges the handoff", async () => {
    const zitadel = connectZitadel(handle);
    const session = await zitadel.seedSession();

    expect(captured.flowStart).toEqual({ project_id: "proj_1", purpose: "login" });
    // Step 1: only the declared email field, threading the flow session token.
    expect(captured.submits[0]).toEqual({
      session_token: "flow-token-1",
      action: "submit",
      fields: { email: session.user.email },
    });
    // Step 2: the schema-pointer field name is matched on its tail segment.
    expect(captured.submits[1]).toEqual({
      session_token: "flow-token-2",
      action: "submit",
      fields: { "x-auth-methods#password": session.user.password },
    });
    expect(captured.exchangeBody).toEqual({ handoff_token: "handoff_1" });
    expect(captured.exchangeProject).toBe("proj_1");
    // The sealed flow-state cookie must round-trip and advance each hop.
    // (msw's node interceptor appends its own virtual cookie store to the
    // header, so assert containment, not equality — the real path has no
    // auto-jar, which is why the kit carries its own.)
    expect(captured.submitCookies[0]).toContain("_zflow=state-1");
    expect(captured.submitCookies[1]).toContain("_zflow=state-2");
    expect(captured.submitCookies[1]).not.toContain("_zflow=state-1");
    // The project's origin allowlist applies to flow calls; the handle's
    // registered app origin is the default.
    expect(captured.flowStartOrigin).toBe("http://app.invalid:3002");

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

  it("mints for an existing user without seeding and honors the flow name", async () => {
    const zitadel = connectZitadel(handle);
    const user = { id: "user_9", email: "kept@acme.com", password: "Fixed-pw-1" };
    server.use(
      http.post(`${BASE}/users`, () => {
        throw new Error("must not seed when a user is provided");
      }),
    );

    const session = await zitadel.seedSession({
      user,
      flowDefinitionName: "custom-login",
      origin: "http://other.invalid",
    });
    expect(captured.flowStart).toEqual({
      project_id: "proj_1",
      purpose: "login",
      flow_definition_name: "custom-login",
    });
    expect(captured.flowStartOrigin).toBe("http://other.invalid");
    expect(session.user).toBe(user);
    expect(captured.submits[0]).toMatchObject({ fields: { email: "kept@acme.com" } });
  });

  it("fails loudly on a step declaring fields it cannot fill", async () => {
    server.use(
      http.post(`${BASE}/flow`, () =>
        HttpResponse.json(
          {
            id: "flow_1",
            session_token: "t",
            step: { name: "mfa-otp", fields: [{ name: "one_time_code" }] },
          },
          { status: 201 },
        ),
      ),
    );
    const zitadel = connectZitadel(handle);
    await expect(zitadel.seedSession()).rejects.toThrow(
      /password flows only.*"mfa-otp".*"one_time_code"/s,
    );
  });

  it("explains a missing Origin when the allowlist rejects the call", async () => {
    server.use(
      http.post(`${BASE}/flow`, () =>
        HttpResponse.json(
          { code: "req.invalid", message: 'origin "x" is not allowed for this project' },
          { status: 400 },
        ),
      ),
    );
    const zitadel = connectZitadel({ ...handle, appOrigin: undefined });
    await expect(zitadel.seedSession()).rejects.toThrow(
      /No Origin header was sent.*appOrigins/s,
    );
  });

  it("caps the number of flow steps instead of looping", async () => {
    server.use(
      http.post(`${BASE}/flow/:id/submit`, () => HttpResponse.json(identifierStep)),
    );
    const zitadel = connectZitadel(handle);
    await expect(zitadel.seedSession()).rejects.toThrow(/did not complete within 6 steps/);
  });
});
