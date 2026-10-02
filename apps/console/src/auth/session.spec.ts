import { getApiCsrfToken, getApiCsrfTokenRefresher, setApiCsrfToken } from "@zitadel/api/runtime/auth";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fetchSession, invalidateSessionCache } from "./session";
import { makeTestSession } from "./session.fixture";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => invalidateSessionCache());
afterEach(() => {
  server.resetHandlers();
  setApiCsrfToken(undefined);
});

function stubSession(status = 200) {
  server.use(
    http.get("*/sessions/me", () =>
      status === 200
        ? HttpResponse.json(makeTestSession())
        : HttpResponse.json({ code: "auth.unauthorized", message: "no" }, { status }),
    ),
  );
}

function stubCsrf(respond: () => Response) {
  let calls = 0;
  server.use(
    http.get("*/sessions/me/csrf", () => {
      calls++;
      return respond();
    }),
  );
  return () => calls;
}

describe("fetchSession", () => {
  it("returns the session and sets the CSRF token", async () => {
    stubSession();
    stubCsrf(() => HttpResponse.json({ csrf_token: "tok" }));

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBe("tok");
  });

  // Only the session decides whether someone is signed in: an old server
  // without /sessions/me/csrf, a proxy that does not forward it, or a transient
  // failure of just that read must not bounce a signed-in user to /login.
  it("keeps the user signed in when only the token read fails", async () => {
    stubSession();
    stubCsrf(() => HttpResponse.json({ code: "not_found", message: "no" }, { status: 404 }));

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBeUndefined();
  });

  it("reports no session on a 401", async () => {
    stubSession(401);
    stubCsrf(() => HttpResponse.json({ code: "auth.unauthorized", message: "no" }, { status: 401 }));

    expect(await fetchSession()).toBeNull();
  });
});

describe("CSRF token refresher", () => {
  it("re-reads the token and drops the cached session", async () => {
    stubSession();
    stubCsrf(() => HttpResponse.json({ csrf_token: "old" }));
    await fetchSession();
    expect(getApiCsrfToken()).toBe("old");

    // Another tab signed in again: the cookie, and with it the token, changed.
    const csrfCalls = stubCsrf(() => HttpResponse.json({ csrf_token: "new" }));
    const refresh = getApiCsrfTokenRefresher();
    expect(refresh).toBeDefined();
    expect(await refresh?.()).toBe("new");
    expect(getApiCsrfToken()).toBe("new");

    // The cache was dropped, so the next navigation reads the session again.
    await fetchSession();
    expect(csrfCalls()).toBe(2);
  });
});
