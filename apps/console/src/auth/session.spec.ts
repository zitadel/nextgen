import {
  getApiCsrfRejectionHandler,
  getApiCsrfToken,
  setApiCsrfToken,
} from "@zitadel/api/runtime/auth";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSession, invalidateSessionCache, sessionPage } from "./session";
import { makeTestSession } from "./session.fixture";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  invalidateSessionCache();
  vi.spyOn(sessionPage, "reload").mockImplementation(() => undefined);
});
afterEach(() => {
  server.resetHandlers();
  setApiCsrfToken(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Answers GET /sessions/me with `user_id`, with a 401 when it is null, or with
 * a 502 for "unreachable".
 */
function stubSession(userId: string | null | "unreachable") {
  server.use(
    http.get("*/sessions/me", () => {
      if (userId === "unreachable") return HttpResponse.text("bad gateway", { status: 502 });
      return userId
        ? HttpResponse.json(makeTestSession({ user_id: userId }))
        : HttpResponse.json({ code: "auth.unauthorized", message: "no" }, { status: 401 });
    }),
  );
}

/** Answers GET /sessions/me/csrf with `respond`; reports how often it was asked. */
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

const token = (value: string) => () => HttpResponse.json({ csrf_token: value });
const failing = () => HttpResponse.json({ code: "internal", message: "no" }, { status: 500 });

/** What customFetch does on a 403 auth.csrf_invalid: ask for a token to retry with. */
function rejectWrite(): Promise<string | undefined> {
  const onRejected = getApiCsrfRejectionHandler();
  if (!onRejected) throw new Error("session.ts registers the rejection handler");
  return onRejected();
}

describe("fetchSession", () => {
  it("returns the session and sets the CSRF token", async () => {
    stubSession("user_a");
    stubCsrf(token("tok"));

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBe("tok");
  });

  // Only the session decides whether someone is signed in: an old server
  // without /sessions/me/csrf, a proxy that does not forward it, or a transient
  // failure of just that read must not bounce a signed-in user to /login.
  it("keeps the user signed in when only the token read fails", async () => {
    stubSession("user_a");
    stubCsrf(failing);

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBeUndefined();
  });

  it("reports no session on a 401", async () => {
    stubSession(null);
    stubCsrf(failing);

    expect(await fetchSession()).toBeNull();
  });

  // The token is stable for the life of a cookie: re-validating the session
  // after the cache window does not read it again, so a failing read there
  // cannot wipe a token that works.
  it("reads the token once, not on every re-validation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    const calls = stubCsrf(token("tok"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    stubCsrf(failing);
    await fetchSession();

    expect(calls()).toBe(1);
    expect(getApiCsrfToken()).toBe("tok");
  });

  // Another tab signed in as someone else. Loading their token here would arm
  // this page's open forms to write as them, so the page starts over instead.
  it("starts over, without loading the new person's token, when someone else is signed in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    stubSession("user_b");
    const calls = stubCsrf(token("tok_b"));
    expect(await fetchSession()).toBeNull();

    expect(calls()).toBe(0);
    expect(getApiCsrfToken()).toBeUndefined();
    expect(sessionPage.reload).toHaveBeenCalledOnce();
  });
});

describe("CSRF rejection", () => {
  it("hands back a fresh token when the same person is still signed in", async () => {
    stubSession("user_a");
    stubCsrf(failing);
    await fetchSession();
    expect(getApiCsrfToken()).toBeUndefined();

    stubCsrf(token("tok"));
    // The token comes back, so customFetch retries the write once with it.
    expect(await rejectWrite()).toBe("tok");

    expect(getApiCsrfToken()).toBe("tok");
    expect(sessionPage.reload).not.toHaveBeenCalled();
  });

  // Another tab signed in as someone else: the refused write is not replayed
  // under that session, and the page, which still shows the first person,
  // starts over with everything cached for them dropped.
  it("starts over when someone else is signed in now", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession("user_b");
    stubCsrf(token("tok_b"));
    // Nothing to retry with: the write is not replayed as user_b.
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).toHaveBeenCalledOnce();
    expect(getApiCsrfToken()).toBeUndefined();
  });

  it("starts over when nobody is signed in any more", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession(null);
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).toHaveBeenCalledOnce();
    expect(getApiCsrfToken()).toBeUndefined();
  });

  // A network blip on the re-check must not cost the person their page: the
  // write stays refused for them to retry, and nothing else changes.
  it("keeps the page when the session cannot be read", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession("unreachable");
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).not.toHaveBeenCalled();
    expect(getApiCsrfToken()).toBe("tok_a");
  });

  // Without a recorded person there is nothing to compare the session to, so
  // no token is handed back and nothing is retried.
  it("does not retry when this page has no person yet", async () => {
    stubSession("user_b");
    stubCsrf(token("tok_b"));

    expect(await rejectWrite()).toBeUndefined();
    expect(getApiCsrfToken()).toBeUndefined();
    expect(sessionPage.reload).not.toHaveBeenCalled();
  });
});
